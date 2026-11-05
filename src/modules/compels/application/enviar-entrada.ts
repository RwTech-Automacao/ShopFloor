import {
  componentesSemSaldo,
  corpoApontamento,
  dataHoraLocal,
  inicioDoDia,
  type ComponenteApontamento,
  type DestinoEstoque,
} from '../domain/corpos'
import { estadoDaOp, type LeiturasOp } from '../domain/estado-op'
import { RespostaInesperada } from '../domain/leituras-erp'
import { decidirEntrada } from '../domain/reconciliar'
import type { ResultadoGravacao } from '../domain/resposta-erp'
import { semSufixo } from '../domain/sem-sufixo'
import type { DadosOp } from '../infra/cliente'
import { ErroDeLogin } from '../infra/token'

/**
 * Entrega UMA entrada do Almoxarifado ao Compels: só APONTA (desde 05/11/2026 a requisição é feita no Compels, não aqui).
 * Só conhece a PORTA `PortaErp`, nunca `fetch`: nos testes entra um Compels de mentira, e no ensaio
 * do servidor entra o cliente real em modo "mostrar, não gravar".
 */
export interface PortaErp {
  buscarOp(numero: number): Promise<DadosOp | null>
  lerOp(op: DadosOp): Promise<LeiturasOp>
  adquirirTrava(idOp: number): Promise<ResultadoGravacao>
  liberarTrava(idOp: number): Promise<void>
  consultarDisponibilidade(op: DadosOp, quantidade: number): Promise<ComponenteApontamento[]>
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
  /**
   * PONTO DE PARTIDA da OP no Compels: o apontado que já existia lá antes de a integração começar (apontamento
   * à mão, por exemplo), guardado na primeira gravação. `null`/ausente = ainda não guardado: vale o que o ERP mostra
   * agora quando nada foi enviado antes (`acumuladoAnterior === 0`), ou 0 quando já há envios (OP anterior a isto).
   */
  base?: number | null
  /** Guarda o ponto de partida lido agora. Chamado UMA vez, DEPOIS da trava e ANTES da primeira gravação. */
  guardarBase?: (base: number) => Promise<void>
  /** Texto gravado na Observação do apontamento (marca de rastreio). */
  marca?: string
}

export type ResultadoEntrada =
  | { ok: true; detalhe: string }
  /**
   * `aguardar`: falhou ANTES de qualquer gravação no ERP e vale tentar de novo (OP em uso, sem empenho,
   * pendência, falta de saldo, ERP fora do ar na leitura). A fila usa isso para não gastar tentativa.
   */
  | { ok: false; erro: string; tentarDeNovo: boolean; aguardar: boolean }

export interface OpcoesEnvio {
  destino: DestinoEstoque
  agora?: () => Date
}

export type Plano =
  | { tipo: 'erro'; erro: string; tentarDeNovo: boolean }
  | { tipo: 'ja_enviada' }
  | {
      tipo: 'enviar'
      op: DadosOp
      /** O apontado que o ERP deve mostrar depois desta entrada (ponto de partida + enviado + esta entrada). */
      novoAcumulado: number
      /** O ponto de partida a guardar antes de gravar; `null` quando ele já está guardado ou não se aplica. */
      baseACapturar: number | null
      apontar: Record<string, unknown>
      /** Empenho/requisição insuficientes no Compels: não bloqueiam, só avisam. */
      avisos: string[]
    }

const recusa = (erro: string, tentarDeNovo = false) => ({ tipo: 'erro', erro, tentarDeNovo }) as const

function numeroDaOp(texto: string): number | null {
  // O Compels só conhece a OP pelos dígitos: `8682_F` e `8504_` (segunda leva no ShopFloor) são 8682 e 8504.
  // O que sobrar não numérico (PMOC50_ → PMOC50) não tem número lá e fica manual.
  const base = semSufixo(texto)
  return /^\d+$/.test(base) ? Number(base) : null
}

function aguardandoRequisicao(componentes: { codigo: string; precisa: number; tem: number }[]): string {
  const lista = componentes.map((c) => `${c.codigo} (precisa ${c.precisa}, requisitado disponível ${c.tem})`).join('; ')
  return `Aguardando requisição no Compels: ${lista}.`
}

/** Avisos (empenho/requisição insuficientes) em uma frase para colar no fim de outra mensagem. */
function textoAvisos(avisos: string[]): string {
  return avisos.length > 0 ? ` Aviso: ${avisos.join('; ')}.` : ''
}

/** Conferências que não precisam da trava: a OP existe, é desta PMO, em UN e de estoque próprio. */
async function conferir(erp: PortaErp, e: EntradaParaEnviar): Promise<{ op: DadosOp } | { erro: Plano & { tipo: 'erro' } }> {
  const numero = numeroDaOp(e.op)
  if (numero === null) return { erro: recusa(`OP "${e.op}" não é numérica; a integração só atende OP numérica. Faça a entrada à mão no Compels.`) }

  const op = await erp.buscarOp(numero)
  if (!op) return { erro: recusa(`OP ${numero} não encontrada no Compels.`) }
  if (op.codigoItem.trim().toUpperCase() !== semSufixo(e.pmo).toUpperCase()) {
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
  const estado = estadoDaOp(await erp.lerOp(op))

  // O apontado do ERP inclui o que já existia lá antes da integração (ponto de partida). Se a OP nunca recebeu
  // envio nosso e o ponto ainda não foi guardado, ele é o que o ERP mostra AGORA (nada nosso pode estar nele).
  const baseGuardada = e.base ?? null
  const baseNova = baseGuardada === null && e.acumuladoAnterior === 0
  const base = baseGuardada ?? (baseNova ? estado.apontada : 0)
  const anterior = e.acumuladoAnterior + base
  const novo = anterior + e.quantidade

  const decisao = decidirEntrada(estado, { anterior, novo })
  if (decisao.tipo === 'erro') {
    return recusa(decisao.mensagem)
  }
  if (decisao.tipo === 'ja_enviada') return { tipo: 'ja_enviada' }

  const componentes = await erp.consultarDisponibilidade(op, decisao.apontar)
  // `saldoDisponivel` é o material JÁ REQUISITADO e ainda não consumido por apontamento (não é o estoque livre da
  // prateleira). A integração não requisita: se não houver o bastante, espera alguém requisitar no Compels.
  const sem = componentesSemSaldo(componentes).map((c) => ({ codigo: c.codigo, precisa: c.quantidadeUtilizada, tem: c.saldoDisponivel }))
  if (sem.length > 0) return recusa(`${aguardandoRequisicao(sem)}${textoAvisos(decisao.avisos)}`, true)

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
  return { tipo: 'enviar', op, novoAcumulado: novo, baseACapturar: baseNova ? base : null, apontar, avisos: decisao.avisos }
}

function erroDeExcecao(e: unknown): { ok: false; erro: string; tentarDeNovo: boolean } {
  if (e instanceof RespostaInesperada) return { ok: false, erro: `${e.message} Confira o Compels antes de reenviar.`, tentarDeNovo: false }
  if (e instanceof ErroDeLogin) return { ok: false, erro: e.message, tentarDeNovo: true }
  return { ok: false, erro: `Erro ao falar com o Compels: ${e instanceof Error ? e.message : String(e)}`, tentarDeNovo: true }
}

/** Falha da entrega; `gravou` = já chamou algum gesto que GRAVA no ERP (aí não é "só esperar"). */
function falha(erro: string, tentarDeNovo: boolean, gravou: boolean): ResultadoEntrada {
  return { ok: false, erro, tentarDeNovo, aguardar: tentarDeNovo && !gravou }
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

/** Entrega a entrada: trava → ler → decidir → consultar saldo → apontar → reler → liberar a trava. */
export async function enviarEntrada(erp: PortaErp, e: EntradaParaEnviar, opcoes: OpcoesEnvio): Promise<ResultadoEntrada> {
  let travada: number | null = null
  let gravou = false
  try {
    const c = await conferir(erp, e)
    if ('erro' in c) return falha(c.erro.erro, c.erro.tentarDeNovo, false)
    const op = c.op

    const trava = await erp.adquirirTrava(op.id)
    if (!trava.ok) return falha(trava.mensagem, trava.tentarDeNovo, false)
    travada = op.id

    // O estado é lido DEPOIS da trava: ninguém muda a OP entre a leitura e a gravação.
    const plano = await planejar(erp, op, e, opcoes)
    if (plano.tipo === 'erro') return falha(plano.erro, plano.tentarDeNovo, false)
    if (plano.tipo === 'ja_enviada') return { ok: true, detalhe: 'O Compels já tinha esta entrada.' }

    // O ponto de partida é guardado ANTES de qualquer gravação: se o processo cair no meio, a nova tentativa
    // lê o mesmo número e reconhece o que já foi gravado (em vez de tomar o apontado novo como ponto de partida).
    if (plano.baseACapturar !== null && e.guardarBase) {
      try {
        await e.guardarBase(plano.baseACapturar)
      } catch (erro) {
        const motivo = erro instanceof Error ? erro.message : String(erro)
        return falha(`Não consegui guardar o ponto de partida da OP (nada foi gravado no Compels): ${motivo}`, true, false)
      }
    }

    // A partir daqui o ERP pode ter recebido algo: falha deixa de ser "só esperar".
    gravou = true
    const a = await erp.apontar(plano.apontar)
    if (!a.ok) {
      return falha(a.mensagem, a.tentarDeNovo, gravou)
    }

    // Conferência final: só vale como enviado se o ERP mostra o acumulado novo.
    const depois = estadoDaOp(await erp.lerOp(op))
    if (depois.apontada < plano.novoAcumulado) {
      return falha(
        `O Compels aceitou a gravação, mas mostra ${depois.apontada} apontadas (esperado ${plano.novoAcumulado}). Confira antes de reenviar.`,
        false,
        gravou,
      )
    }
    return { ok: true, detalhe: `Apontado.${textoAvisos(plano.avisos)}` }
  } catch (erro) {
    const r = erroDeExcecao(erro)
    return falha(r.erro, r.tentarDeNovo, gravou)
  } finally {
    if (travada !== null) {
      try { await erp.liberarTrava(travada) } catch { /* a trava expira sozinha; não esconde o resultado */ }
    }
  }
}
