import {
  componentesSemSaldo,
  corpoApontamento,
  corpoRequisicao,
  dataHoraLocal,
  inicioDoDia,
  type ComponenteApontamento,
  type ComponenteRequisicao,
  type DestinoEstoque,
} from '../domain/corpos'
import { estadoDaOp, type LeiturasOp } from '../domain/estado-op'
import { RespostaInesperada } from '../domain/leituras-erp'
import { decidirEntrada } from '../domain/reconciliar'
import type { ResultadoGravacao } from '../domain/resposta-erp'
import type { DadosOp } from '../infra/cliente'
import { ErroDeLogin } from '../infra/token'

/**
 * Entrega UMA entrada do Almoxarifado ao Compels: Requisitar + Apontar (spec 16/10/2026, §3.2).
 * Só conhece a PORTA `PortaErp`, nunca `fetch`: nos testes entra um Compels de mentira, e no ensaio
 * do servidor entra o cliente real em modo "mostrar, não gravar".
 */
export interface PortaErp {
  buscarOp(numero: number): Promise<DadosOp | null>
  lerOp(op: DadosOp): Promise<LeiturasOp>
  adquirirTrava(idOp: number): Promise<ResultadoGravacao>
  liberarTrava(idOp: number): Promise<void>
  consultarRequisicao(op: DadosOp, quantidade: number): Promise<ComponenteRequisicao[]>
  consultarDisponibilidade(op: DadosOp, quantidade: number): Promise<ComponenteApontamento[]>
  requisitar(corpo: Record<string, unknown>): Promise<ResultadoGravacao>
  apontar(corpo: Record<string, unknown>): Promise<ResultadoGravacao>
}

export interface EntradaParaEnviar {
  /** Código do produto (a PMO) como o ShopFloor conhece. */
  pmo: string
  /** Número da OP, como o ShopFloor guarda (texto). */
  op: string
  /** Peças desta entrada. */
  quantidade: number
  /** Soma das entradas desta OP que o ShopFloor já enviou com sucesso. */
  acumuladoAnterior: number
  /** Texto gravado na Observação do apontamento (marca de rastreio). */
  marca?: string
}

export type ResultadoEntrada =
  | { ok: true; detalhe: string }
  | { ok: false; erro: string; tentarDeNovo: boolean }

export interface OpcoesEnvio {
  destino: DestinoEstoque
  agora?: () => Date
}

export type Plano =
  | { tipo: 'erro'; erro: string; tentarDeNovo: boolean }
  | { tipo: 'ja_enviada' }
  | { tipo: 'enviar'; op: DadosOp; novoAcumulado: number; requisitar: Record<string, unknown> | null; apontar: Record<string, unknown> }

const recusa = (erro: string, tentarDeNovo = false) => ({ tipo: 'erro', erro, tentarDeNovo }) as const

function numeroDaOp(texto: string): number | null {
  // OPs com sufixo (PMOC50_, 8504_) existem no ShopFloor e não têm número no Compels: ficam manuais.
  return /^\d+$/.test(texto.trim()) ? Number(texto.trim()) : null
}

function faltas(componentes: { codigo: string; precisa: number; tem: number }[]): string {
  const lista = componentes.map((c) => `${c.codigo} (precisa ${c.precisa}, tem ${c.tem})`).join('; ')
  return `Falta saldo de componente no Compels: ${lista}.`
}

/** Conferências que não precisam da trava: a OP existe, é desta PMO, em UN e de estoque próprio. */
async function conferir(erp: PortaErp, e: EntradaParaEnviar): Promise<{ op: DadosOp } | { erro: Plano & { tipo: 'erro' } }> {
  const numero = numeroDaOp(e.op)
  if (numero === null) return { erro: recusa(`OP "${e.op}" não é numérica; a integração só atende OP numérica. Faça a entrada à mão no Compels.`) }

  const op = await erp.buscarOp(numero)
  if (!op) return { erro: recusa(`OP ${numero} não encontrada no Compels.`) }
  if (op.codigoItem.trim().toUpperCase() !== e.pmo.trim().toUpperCase()) {
    return { erro: recusa(`O produto da OP ${numero} no Compels (${op.codigoItem}) é diferente da PMO ${e.pmo}.`) }
  }
  if (op.unidade !== 'UN') {
    return { erro: recusa(`Produto em ${op.unidade || 'unidade desconhecida'}: a integração só atende UN. Faça a entrada à mão no Compels.`) }
  }
  return { op }
}

/** Com a OP já conferida: lê o estado, decide, consulta os componentes e monta os corpos. Não grava. */
async function planejar(erp: PortaErp, op: DadosOp, e: EntradaParaEnviar, opcoes: OpcoesEnvio): Promise<Plano> {
  const agora = (opcoes.agora ?? (() => new Date()))()
  const novo = e.acumuladoAnterior + e.quantidade
  const estado = estadoDaOp(await erp.lerOp(op))

  const decisao = decidirEntrada(estado, { anterior: e.acumuladoAnterior, novo })
  if (decisao.tipo === 'erro') {
    return recusa(decisao.mensagem, decisao.codigo === 'sem_empenho' || decisao.codigo === 'pendencia_no_erp')
  }
  if (decisao.tipo === 'ja_enviada') return { tipo: 'ja_enviada' }

  let requisitar: Record<string, unknown> | null = null
  if (decisao.requisitar > 0) {
    const componentes = await erp.consultarRequisicao(op, decisao.requisitar)
    const sem = componentes
      .filter((c) => !c.itemFantasma && c.saldo < c.quantidadeRequisitar)
      .map((c) => ({ codigo: c.codigo, precisa: c.quantidadeRequisitar, tem: c.saldo }))
    if (sem.length > 0) return recusa(faltas(sem), true)
    requisitar = corpoRequisicao({ opId: op.id, tipoPropriedade: op.tipoPropriedade, quantidade: decisao.requisitar, componentes })
  }

  const componentes = await erp.consultarDisponibilidade(op, decisao.apontar)
  const sem = componentesSemSaldo(componentes).map((c) => ({ codigo: c.codigo, precisa: c.quantidadeUtilizada, tem: c.saldoDisponivel }))
  if (sem.length > 0) return recusa(faltas(sem), true)

  const apontar = corpoApontamento({
    opId: op.id,
    produtoId: op.produtoId,
    quantidade: decisao.apontar,
    // A tela repete o início do primeiro apontamento da OP; sendo o primeiro, é hoje às 00:00.
    dataInicio: estado.inicioApontamento ?? inicioDoDia(agora),
    dataFim: dataHoraLocal(agora),
    componentes,
    destino: opcoes.destino,
    ...(e.marca ? { observacao: e.marca } : {}),
  })
  return { tipo: 'enviar', op, novoAcumulado: novo, requisitar, apontar }
}

function erroDeExcecao(e: unknown): { ok: false; erro: string; tentarDeNovo: boolean } {
  if (e instanceof RespostaInesperada) return { ok: false, erro: `${e.message} Confira o Compels antes de reenviar.`, tentarDeNovo: false }
  if (e instanceof ErroDeLogin) return { ok: false, erro: e.message, tentarDeNovo: true }
  return { ok: false, erro: `Erro ao falar com o Compels: ${e instanceof Error ? e.message : String(e)}`, tentarDeNovo: true }
}

/**
 * ENSAIO: faz tudo menos gravar e menos pegar a trava. Devolve o plano com os corpos que SERIAM
 * enviados, para conferir contra a captura da tela antes da primeira gravação real.
 */
export async function ensaiarEntrada(erp: PortaErp, e: EntradaParaEnviar, opcoes: OpcoesEnvio): Promise<Plano> {
  try {
    const c = await conferir(erp, e)
    if ('erro' in c) return c.erro
    return await planejar(erp, c.op, e, opcoes)
  } catch (erro) {
    const r = erroDeExcecao(erro)
    return { tipo: 'erro', erro: r.erro, tentarDeNovo: r.tentarDeNovo }
  }
}

/** Entrega a entrada: trava → ler → decidir → consultar → requisitar → apontar → reler → liberar a trava. */
export async function enviarEntrada(erp: PortaErp, e: EntradaParaEnviar, opcoes: OpcoesEnvio): Promise<ResultadoEntrada> {
  let travada: number | null = null
  try {
    const c = await conferir(erp, e)
    if ('erro' in c) return { ok: false, erro: c.erro.erro, tentarDeNovo: c.erro.tentarDeNovo }
    const op = c.op

    const trava = await erp.adquirirTrava(op.id)
    if (!trava.ok) return { ok: false, erro: trava.mensagem, tentarDeNovo: trava.tentarDeNovo }
    travada = op.id

    // O estado é lido DEPOIS da trava: ninguém muda a OP entre a leitura e a gravação.
    const plano = await planejar(erp, op, e, opcoes)
    if (plano.tipo === 'erro') return { ok: false, erro: plano.erro, tentarDeNovo: plano.tentarDeNovo }
    if (plano.tipo === 'ja_enviada') return { ok: true, detalhe: 'O Compels já tinha esta entrada.' }

    if (plano.requisitar) {
      const r = await erp.requisitar(plano.requisitar)
      if (!r.ok) return { ok: false, erro: r.mensagem, tentarDeNovo: r.tentarDeNovo }
    }
    const a = await erp.apontar(plano.apontar)
    if (!a.ok) {
      const aviso = plano.requisitar ? ' A requisição já foi feita; a próxima tentativa só aponta.' : ''
      return { ok: false, erro: `${a.mensagem}${aviso}`, tentarDeNovo: a.tentarDeNovo }
    }

    // Conferência final: só vale como enviado se o ERP mostra o acumulado novo.
    const depois = estadoDaOp(await erp.lerOp(op))
    if (depois.apontada < plano.novoAcumulado) {
      return {
        ok: false,
        erro: `O Compels aceitou a gravação, mas mostra ${depois.apontada} apontadas (esperado ${plano.novoAcumulado}). Confira antes de reenviar.`,
        tentarDeNovo: false,
      }
    }
    return { ok: true, detalhe: plano.requisitar ? 'Requisitado e apontado.' : 'Apontado.' }
  } catch (erro) {
    return erroDeExcecao(erro)
  } finally {
    if (travada !== null) {
      try { await erp.liberarTrava(travada) } catch { /* a trava expira sozinha; não esconde o resultado */ }
    }
  }
}
