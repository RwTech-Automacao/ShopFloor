import {
  avaliarNota, lerNota, TEXTO_MOTIVO,
  type DecisaoNota, type NotaPendente,
} from '../domain/baixa-nf'
import type { ResultadoGravacao } from '../domain/resposta-erp'

/**
 * Baixa de NF com fila de prioridade (spec 2026-11-17-faturamento-baixa-nf-design.md). Só baixa o que alguém
 * selecionou na tela do Faturamento: `confirmarSelecao` tenta na hora, na ordem marcada; o que não tem saldo
 * entra na fila, e o cron (`processarFila`) percorre a fila em ordem e baixa cada nota que já tem saldo.
 */

/** O pedaço do Compels que a baixa usa. Nos testes entra um Compels de mentira. */
export interface PortaBaixaNf {
  listarNfsPendentes(): Promise<Record<string, unknown>[]>
  itensDaNf(idNota: number): Promise<{ proprias: unknown[]; emTerceiros: unknown[]; deTerceiros: unknown[] }>
  travarNf(idNota: number): Promise<ResultadoGravacao>
  liberarNf(idNota: number): Promise<void>
  baixarNf(corpo: Record<string, unknown>): Promise<ResultadoGravacao>
}

export type ModoBaixaNf = 'simular' | 'baixar'

export interface OpcoesBaixa {
  modo: ModoBaixaNf
  /** Vai no `usuarioAceiteBaixa` e na observação da baixa no Compels. */
  usuario: string
}

/** Uma nota aguardando na fila (em ordem de posição). */
export interface ItemFila {
  id: string
  notaId: number
  numero: number
  cliente: string
  /** Falhas SEGUIDAS da baixa (recusa ou erro do Compels). Sem saldo / nota aberta zeram. */
  tentativas: number
}

export interface NotaParaFila {
  notaId: number
  numero: number
  cliente: string
}

/** A fila vista pela confirmação (usuário logado; grava pelas funções do banco). */
export interface FilaDaConfirmacao {
  aguardando(): Promise<ItemFila[]>
  /**
   * `aguardando` entra no fim da fila e devolve a posição; `baixada` só fica registrada (histórico de quem
   * baixou) e devolve `posicao: null`. A simulação nunca grava `simulada`: a nota entra na fila (não é consumida).
   */
  colocar(
    nota: NotaParaFila,
    r: { status: 'aguardando' | 'baixada'; mensagem: string; tentativas: number },
  ): Promise<{ posicao: number | null }>
}

/** A fila vista pelo cron (service role). */
export interface FilaDoCron {
  aguardando(): Promise<ItemFila[]>
  tentativa(id: string, r: { mensagem: string; tentativas: number }): Promise<void>
  finalizar(id: string, status: 'baixada' | 'baixada_fora' | 'falhou', mensagem: string): Promise<void>
}

/** Falhas seguidas da baixa até a nota sair da fila como `falhou`. */
export const MAX_FALHAS_SEGUIDAS = 5

const itensTexto = (d: Extract<DecisaoNota, { acao: 'baixar' }>) =>
  d.itens.map((i) => `${i.quantidade} × ${i.codigo || '?'}`).join(', ')

const textoSimulacao = (d: Extract<DecisaoNota, { acao: 'baixar' }>) => `simulação: seria baixada — ${itensTexto(d)}`

const textoErro = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const clienteDaNota = (n: NotaPendente) => [n.clienteCodigo, n.clienteNome].filter(Boolean).join(' — ')

function pendentesPorId(linhas: Record<string, unknown>[]): Map<number, NotaPendente> {
  const m = new Map<number, NotaPendente>()
  for (const l of linhas) {
    const n = lerNota(l)
    if (n) m.set(n.id, n)
  }
  return m
}

type Tentativa =
  | { tipo: 'baixada'; detalhe: string }
  | { tipo: 'simulada'; detalhe: string }
  | { tipo: 'sem_saldo'; detalhe: string }
  | { tipo: 'manual'; detalhe: string }
  | { tipo: 'aberta'; detalhe: string }
  | { tipo: 'falha'; detalhe: string }

/**
 * Relê os itens da nota no Compels e tenta baixar AGORA. Em `simular` nunca trava nem baixa. A trava da nota é
 * sempre liberada, mesmo quando o baixar falha.
 */
async function tentarBaixar(porta: PortaBaixaNf, nota: NotaPendente, op: OpcoesBaixa): Promise<Tentativa> {
  const itens = await porta.itensDaNf(nota.id)
  const d = avaliarNota({ nota, ...itens, usuario: op.usuario })
  if (d.acao === 'esperar') return { tipo: 'sem_saldo', detalhe: TEXTO_MOTIVO[d.motivo] }
  if (d.acao === 'manual') return { tipo: 'manual', detalhe: TEXTO_MOTIVO[d.motivo] }
  if (op.modo === 'simular') return { tipo: 'simulada', detalhe: textoSimulacao(d) }

  const trava = await porta.travarNf(nota.id)
  if (!trava.ok) return { tipo: 'aberta', detalhe: `nota aberta no Compels: ${trava.mensagem}` }
  try {
    const r = await porta.baixarNf(d.corpo)
    return r.ok ? { tipo: 'baixada', detalhe: `${itensTexto(d)} — ${r.mensagem}` } : { tipo: 'falha', detalhe: r.mensagem }
  } catch (e) {
    return { tipo: 'falha', detalhe: textoErro(e) }
  } finally {
    await porta.liberarNf(nota.id).catch(() => undefined)
  }
}

export interface ResultadoConfirmacao {
  notaId: number
  numero: number | null
  resultado: 'baixada' | 'simulada' | 'na_fila' | 'manual' | 'ja_na_fila' | 'nao_pendente' | 'erro'
  detalhe: string
  /** Posição na fila (só `na_fila` / `ja_na_fila`). */
  posicao?: number
}

/**
 * A confirmação da tela: nota por nota, NA ORDEM MARCADA (a ordem é a prioridade), relê a nota no Compels. Com
 * saldo no PA para todos os itens → baixa na hora; sem saldo, nota aberta no Compels ou baixa recusada → fim da
 * fila; baixa manual → recusa com o motivo. Uma nota de cada vez: em disputa pelo mesmo saldo, a primeira
 * marcada baixa e a outra relê os itens já sem ele.
 */
export async function confirmarSelecao(
  porta: PortaBaixaNf,
  fila: FilaDaConfirmacao,
  notaIds: number[],
  op: OpcoesBaixa,
): Promise<ResultadoConfirmacao[]> {
  const pendentes = pendentesPorId(await porta.listarNfsPendentes())
  const naFila = await fila.aguardando()
  const saida: ResultadoConfirmacao[] = []
  for (const notaId of [...new Set(notaIds)]) {
    const nota = pendentes.get(notaId)
    if (!nota) {
      saida.push({ notaId, numero: null, resultado: 'nao_pendente', detalhe: 'a nota não está mais pendente de baixa no Compels' })
      continue
    }
    const base = { notaId, numero: nota.numero }
    const ja = naFila.findIndex((i) => i.notaId === notaId)
    if (ja >= 0) {
      saida.push({ ...base, resultado: 'ja_na_fila', posicao: ja + 1, detalhe: `já está na fila (nº ${ja + 1})` })
      continue
    }
    const paraFila = { notaId, numero: nota.numero, cliente: clienteDaNota(nota) }
    try {
      const t = await tentarBaixar(porta, nota, op)
      if (t.tipo === 'manual') { saida.push({ ...base, resultado: 'manual', detalhe: t.detalhe }); continue }
      if (t.tipo === 'simulada') {
        // Simulação NÃO consome a seleção: a nota entra na fila na ordem marcada, para baixar de verdade (na
        // mesma ordem) quando o interruptor virar `1`.
        const { posicao } = await fila.colocar(paraFila, { status: 'aguardando', mensagem: t.detalhe, tentativas: 0 })
        saida.push({
          ...base, resultado: 'simulada', ...(posicao != null ? { posicao } : {}),
          detalhe: `simulação: seria baixada agora — entrou na fila na posição ${posicao ?? '?'}`,
        })
        continue
      }
      if (t.tipo === 'baixada') {
        // A baixa JÁ aconteceu no Compels: falhar ao registrar no histórico não pode virar "erro" na tela.
        const registro = await fila.colocar(paraFila, { status: t.tipo, mensagem: t.detalhe, tentativas: 0 })
          .then(() => '', (e: unknown) => ` (não ficou registrada no histórico: ${textoErro(e)})`)
        saida.push({ ...base, resultado: 'baixada', detalhe: t.detalhe + registro })
        continue
      }
      const { posicao } = await fila.colocar(paraFila, {
        status: 'aguardando', mensagem: t.detalhe, tentativas: t.tipo === 'falha' ? 1 : 0,
      })
      saida.push({ ...base, resultado: 'na_fila', detalhe: t.detalhe, ...(posicao != null ? { posicao } : {}) })
    } catch (e) {
      saida.push({ ...base, resultado: 'erro', detalhe: textoErro(e) })
    }
  }
  return saida
}

export interface ResultadoFila {
  numero: number
  /** `falha` = recusa/erro que ainda fica na fila; `falhou` = saiu da fila sem baixar. */
  resultado: 'baixada' | 'simulada' | 'baixada_fora' | 'esperando' | 'falha' | 'falhou'
  detalhe: string
}

export interface ResumoFila {
  modo: ModoBaixaNf
  notas: ResultadoFila[]
}

/**
 * Uma rodada do cron: percorre a fila EM ORDEM e baixa cada nota que já tem saldo. Nota sem saldo não trava as
 * de trás. Nota que deixou de estar pendente no Compels sai como `baixada_fora`. Recusa/erro do Compels soma uma
 * falha; na `MAX_FALHAS_SEGUIDAS`ª seguida a nota sai como `falhou`. Em `simular` a nota que seria baixada FICA na
 * fila (mesma posição, falhas iguais) só com a mensagem "simulação: seria baixada" — a fila não é consumida.
 */
export async function processarFila(porta: PortaBaixaNf, fila: FilaDoCron, op: OpcoesBaixa): Promise<ResumoFila> {
  const itens = await fila.aguardando()
  if (itens.length === 0) return { modo: op.modo, notas: [] }
  const pendentes = pendentesPorId(await porta.listarNfsPendentes())
  const saida: ResultadoFila[] = []
  for (const item of itens) {
    const nota = pendentes.get(item.notaId)
    if (!nota) {
      const detalhe = 'deixou de estar pendente no Compels (baixada fora do ShopFloor)'
      await fila.finalizar(item.id, 'baixada_fora', detalhe)
      saida.push({ numero: item.numero, resultado: 'baixada_fora', detalhe })
      continue
    }
    let t: Tentativa
    try {
      t = await tentarBaixar(porta, nota, op)
    } catch (e) {
      t = { tipo: 'falha', detalhe: textoErro(e) }
    }
    if (t.tipo === 'baixada') {
      await fila.finalizar(item.id, 'baixada', t.detalhe)
      saida.push({ numero: item.numero, resultado: 'baixada', detalhe: t.detalhe })
    } else if (t.tipo === 'simulada') {
      await fila.tentativa(item.id, { mensagem: t.detalhe, tentativas: item.tentativas })
      saida.push({ numero: item.numero, resultado: 'simulada', detalhe: t.detalhe })
    } else if (t.tipo === 'manual') {
      await fila.finalizar(item.id, 'falhou', `baixa manual: ${t.detalhe}`)
      saida.push({ numero: item.numero, resultado: 'falhou', detalhe: `baixa manual: ${t.detalhe}` })
    } else if (t.tipo === 'falha') {
      const tentativas = item.tentativas + 1
      if (tentativas >= MAX_FALHAS_SEGUIDAS) {
        await fila.finalizar(item.id, 'falhou', t.detalhe)
        saida.push({ numero: item.numero, resultado: 'falhou', detalhe: t.detalhe })
      } else {
        await fila.tentativa(item.id, { mensagem: t.detalhe, tentativas })
        saida.push({ numero: item.numero, resultado: 'falha', detalhe: t.detalhe })
      }
    } else {
      // sem saldo ou nota aberta no Compels: não é falha da baixa — zera as falhas seguidas.
      await fila.tentativa(item.id, { mensagem: t.detalhe, tentativas: 0 })
      saida.push({ numero: item.numero, resultado: 'esperando', detalhe: t.detalhe })
    }
  }
  return { modo: op.modo, notas: saida }
}

/**
 * O interruptor (`COMPELS_BAIXA_NF`): `simular` faz tudo menos a baixa; `1` baixa de verdade; ausente (ou valor
 * desconhecido) = `null`: a tela fica só leitura e o cron não faz nada.
 */
export function configBaixaNf(env: Record<string, string | undefined> = process.env): OpcoesBaixa | null {
  const modoBruto = (env.COMPELS_BAIXA_NF ?? '').trim().toLowerCase()
  const modo: ModoBaixaNf | null = modoBruto === 'simular' ? 'simular' : ['1', 'true', 'sim'].includes(modoBruto) ? 'baixar' : null
  if (!modo) return null
  return { modo, usuario: env.COMPELS_BAIXA_NF_USUARIO?.trim() || 'ShopFloor' }
}

const ROTULO_AVISO: Partial<Record<ResultadoFila['resultado'], string>> = {
  baixada: '✅ NF baixada pela fila',
  simulada: '🧪 (simulação) a NF da fila seria baixada',
  falhou: '❌ NF saiu da fila sem baixar',
}

/**
 * Mensagens do Discord desta rodada da fila. Nota esperando saldo ou com falha que ainda vai ser tentada não
 * avisa. Cada nota avisa UMA vez por situação (a chave vai para `jaAvisadas`, que vive enquanto o processo vive).
 */
export function mensagensDeAviso(resumo: ResumoFila, jaAvisadas: Set<string>): string[] {
  const saida: string[] = []
  for (const n of resumo.notas) {
    const rotulo = ROTULO_AVISO[n.resultado]
    if (!rotulo) continue
    const chave = `${n.numero}|${n.resultado}|${n.detalhe}`
    if (jaAvisadas.has(chave)) continue
    jaAvisadas.add(chave)
    saida.push(`${rotulo}: **NF ${n.numero}** — ${n.detalhe}`)
  }
  return saida
}
