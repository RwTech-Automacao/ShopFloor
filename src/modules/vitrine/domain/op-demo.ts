/**
 * A OP da VITRINE (marketing): uma OP fictícia com produção perfeita — sem reprova, sem Manutenção —
 * calculada inteira em memória. Nada aqui lê banco, Compels ou servidor.
 *
 * O modelo gera os BIPES de cada peça (como as linhas de `sf_registros`) e as telas derivam tudo deles
 * com as MESMAS regras puras do Fluxo real (`postoPendenteDePeca`, `construirFluxo`, `pareaBurnin`…). Assim
 * a vitrine nunca mostra um número que o Fluxo real não mostraria para os mesmos bipes.
 *
 * Tempo: tudo é medido em MINUTOS SIMULADOS desde o início da OP. A peça i começa no Printer em
 * `i × CADENCIA` e chega a cada posto depois de um atraso fixo (+ uma variação pequena e determinística).
 * O "agora" da tela é um minuto simulado `t`: só existem os bipes com minuto ≤ t. A fonte da vitrine
 * avança `t` enquanto a tela está aberta (as peças andam) e volta ao começo do laço.
 */
import {
  construirFluxo,
  postoPendenteDePeca,
  MANUTENCAO,
  type BipePeca,
  type FluxoAgregado,
  type FluxoEdge,
  type FluxoNodePos,
} from '@/modules/shopfloor/domain/fluxo-op'
import { pareaBurnin, estaAberto } from '@/modules/shopfloor/domain/burnin'

export const PMO_DEMO = 'DEMO'
export const OP_DEMO = 'DEMO-01'
export const DESCRICAO_DEMO = 'Placa controladora'
export const CLIENTE_DEMO = 'Cliente Demonstração'
export const QTD_DEMO = 1000
export const PECAS_POR_CAIXA = 50

/** Peça i (0-based) começa no Printer neste minuto × i. */
const CADENCIA = 2.6

export interface PostoDemo {
  nome: string
  temStatus: boolean
  recurso: string
  /** Minutos depois do posto ANTERIOR (no Printer: depois do início da peça). */
  atraso: number
  colaborador: string
}

/** A rota de placa típica. `recurso` igual aos perfis reais (burnin, caixa, nqa, almoxarifado). */
export const POSTOS_DEMO: PostoDemo[] = [
  { nome: 'Printer', temStatus: false, recurso: 'nenhum', atraso: 0, colaborador: 'Ana Souza' },
  { nome: 'SPI', temStatus: true, recurso: 'nenhum', atraso: 2, colaborador: 'Bruno Lima' },
  { nome: 'Pick & Place', temStatus: false, recurso: 'nenhum', atraso: 3, colaborador: 'Carla Mendes' },
  { nome: 'Forno', temStatus: false, recurso: 'nenhum', atraso: 6, colaborador: 'Carla Mendes' },
  { nome: 'AOI', temStatus: true, recurso: 'nenhum', atraso: 8, colaborador: 'Diego Alves' },
  { nome: 'Montagem PTH', temStatus: false, recurso: 'nenhum', atraso: 30, colaborador: 'Elaine Rocha' },
  { nome: 'Inspeção PTH', temStatus: true, recurso: 'nenhum', atraso: 15, colaborador: 'Fábio Costa' },
  { nome: 'Teste funcional', temStatus: true, recurso: 'nenhum', atraso: 20, colaborador: 'Gabriela Dias' },
  { nome: 'Burn-in', temStatus: true, recurso: 'burnin', atraso: 15, colaborador: 'Gabriela Dias' },
  { nome: 'Embalagem', temStatus: false, recurso: 'caixa', atraso: 20, colaborador: 'Henrique Prado' },
  { nome: 'NQA', temStatus: true, recurso: 'nqa', atraso: 30, colaborador: 'Isabela Nunes' },
  { nome: 'Almoxarifado', temStatus: false, recurso: 'almoxarifado', atraso: 60, colaborador: 'João Martins' },
]
/** Horas de Burn-in (entrada → saída aprovada). */
export const BURNIN_MIN = 240

export const NOMES_POSTOS = POSTOS_DEMO.map((p) => p.nome)
const POSTO = new Map(POSTOS_DEMO.map((p) => [p.nome.toLowerCase(), p]))
const recursoDe = (p: string) => POSTO.get(p.toLowerCase())?.recurso ?? 'nenhum'
const temStatusDe = (p: string) => POSTO.get(p.toLowerCase())?.temStatus ?? false
// Ninguém reprova: nenhum posto roteia para a Manutenção (sem aresta de reprova no desenho).
const exigeManutencaoDe = () => false

/** Minuto simulado em que a OP está "congelada" (~93%) e o laço da animação. */
export const T_INICIO_LACO = 2870
export const T_FIM_LACO = 2990

/** Um bipe da OP demo (o equivalente de uma linha de `sf_registros`). */
export interface BipeDemo {
  sn: string
  posto: string
  status: string // '' = passagem / entrada do Burn-in; 'Aprovado'
  minuto: number
  caixa: string
  colaborador: string
  seq: number // desempate estável
}

export function snDaPeca(i: number): string {
  return `DEMO${String(i + 1).padStart(6, '0')}`
}

export function caixaDaPeca(i: number): string {
  return `CX[${Math.floor(i / PECAS_POR_CAIXA) + 1}]`
}

/** Variação determinística em [0, 1) por (peça, posto) — a fila não parece de robô, e é sempre igual. */
function variacao(i: number, k: number): number {
  let h = (i + 1) * 374761393 + (k + 1) * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return ((h >>> 0) % 1000) / 1000
}

/** TODOS os bipes da OP (até o fim), em ordem cronológica. Calculado uma vez. */
function gerarTodos(): BipeDemo[] {
  const out: BipeDemo[] = []
  let seq = 0
  for (let i = 0; i < QTD_DEMO; i++) {
    let m = i * CADENCIA
    const sn = snDaPeca(i)
    POSTOS_DEMO.forEach((p, k) => {
      m += p.atraso + (k === 0 ? 0 : variacao(i, k) * 1.5)
      const caixa = p.recurso === 'caixa' || p.recurso === 'nqa' || p.recurso === 'almoxarifado' ? caixaDaPeca(i) : ''
      if (p.recurso === 'burnin') {
        out.push({ sn, posto: p.nome, status: '', minuto: m, caixa, colaborador: p.colaborador, seq: seq++ })
        m += BURNIN_MIN
      }
      out.push({ sn, posto: p.nome, status: p.temStatus ? 'Aprovado' : '', minuto: m, caixa, colaborador: p.colaborador, seq: seq++ })
    })
  }
  return out.sort((a, b) => a.minuto - b.minuto || a.seq - b.seq)
}

let cacheTodos: BipeDemo[] | null = null
function todos(): BipeDemo[] {
  cacheTodos ??= gerarTodos()
  return cacheTodos
}

/** Os bipes que já aconteceram no minuto simulado `t` (cronológico). */
export function bipesAte(t: number): BipeDemo[] {
  const lista = todos()
  // busca binária do 1º bipe depois de t
  let lo = 0
  let hi = lista.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lista[mid]!.minuto <= t) lo = mid + 1
    else hi = mid
  }
  return lista.slice(0, lo)
}

function porPeca(bipes: BipeDemo[]): Map<string, BipeDemo[]> {
  const m = new Map<string, BipeDemo[]>()
  for (const b of bipes) {
    const e = m.get(b.sn)
    if (e) e.push(b)
    else m.set(b.sn, [b])
  }
  return m
}

const paraBipePeca = (b: BipeDemo): BipePeca => ({ posto: b.posto, status: b.status })

/** Onde cada peça INICIADA está aguardando (null = concluiu). */
export function pendentesPorPeca(t: number): Map<string, string | null> {
  const res = new Map<string, string | null>()
  for (const [sn, regs] of porPeca(bipesAte(t))) {
    res.set(sn, postoPendenteDePeca(regs.map(paraBipePeca), NOMES_POSTOS, exigeManutencaoDe, recursoDe))
  }
  return res
}

export interface ResumoDemo {
  agregados: FluxoAgregado[]
  naoIniciadas: number
  finalizadas: number
}

/**
 * Os agregados por posto no minuto `t`, no formato que a RPC `sf_fluxo_op` + `contarPendentesPorPosto`
 * entregam ao `construirFluxo`. `minutoParaIso` converte o minuto simulado em data (a fonte ancora no
 * relógio da tela).
 */
export function resumir(t: number, minutoParaIso: (m: number) => string): ResumoDemo {
  const bipes = bipesAte(t)
  const pend = pendentesPorPeca(t)
  const fila: Record<string, number> = {}
  let finalizadas = 0
  for (const p of pend.values()) {
    if (p == null) finalizadas++
    else fila[p.toLowerCase()] = (fila[p.toLowerCase()] ?? 0) + 1
  }
  const naoIniciadas = QTD_DEMO - pend.size
  if (naoIniciadas > 0) fila[NOMES_POSTOS[0]!.toLowerCase()] = (fila[NOMES_POSTOS[0]!.toLowerCase()] ?? 0) + naoIniciadas

  const caixasAlmox = new Set<string>()
  const embaladasPorCaixa = new Map<string, number>()
  const agg = new Map<string, { registros: number; aprovadas: number; sns: Set<string>; primeiro: number; ultimo: number }>()
  for (const b of bipes) {
    const k = b.posto.toLowerCase()
    const a = agg.get(k) ?? { registros: 0, aprovadas: 0, sns: new Set<string>(), primeiro: b.minuto, ultimo: b.minuto }
    a.registros++
    if (b.status === 'Aprovado') a.aprovadas++
    // A entrada do Burn-in não é passagem (a peça ainda está cozinhando).
    if (!(recursoDe(b.posto) === 'burnin' && b.status === '')) a.sns.add(b.sn)
    a.ultimo = b.minuto
    agg.set(k, a)
    if (recursoDe(b.posto) === 'almoxarifado') caixasAlmox.add(b.caixa)
    if (recursoDe(b.posto) === 'caixa') embaladasPorCaixa.set(b.caixa, (embaladasPorCaixa.get(b.caixa) ?? 0) + 1)
  }
  const caixasFechadas = [...embaladasPorCaixa.values()].filter((n) => n >= PECAS_POR_CAIXA).length

  const agregados: FluxoAgregado[] = [...NOMES_POSTOS, MANUTENCAO].map((posto) => {
    const a = agg.get(posto.toLowerCase())
    const ehAlmox = recursoDe(posto) === 'almoxarifado'
    const passou = a?.sns.size ?? 0
    return {
      posto,
      wip: fila[posto.toLowerCase()] ?? 0,
      registros: a?.registros ?? 0,
      aprovadas: a?.aprovadas ?? 0,
      reprovadas: 0,
      retestes: 0,
      aprovadosPrimeira: temStatusDe(posto) ? passou : 0,
      reprovadosSemReteste: 0,
      passouDistinto: passou,
      primeiroEm: a ? minutoParaIso(a.primeiro) : null,
      ultimoEm: a ? minutoParaIso(a.ultimo) : null,
      ...(ehAlmox ? { caixasBipadas: caixasAlmox.size, caixasFechadas } : {}),
    }
  })
  return { agregados, naoIniciadas, finalizadas }
}

/** Nós e arestas do canvas no minuto `t` — a mesma montagem do Fluxo real. */
export function fluxoDemo(t: number, minutoParaIso: (m: number) => string): { nodes: FluxoNodePos[]; edges: FluxoEdge[] } {
  const r = resumir(t, minutoParaIso)
  return construirFluxo(NOMES_POSTOS, r.agregados, temStatusDe, recursoDe, QTD_DEMO, exigeManutencaoDe, r.naoIniciadas, r.finalizadas)
}

/** Peças em Burn-in agora (ciclo aberto) + entradas e saídas, como o detalhe real do nó. */
export function burninDemo(t: number, posto: string, minutoParaIso: (m: number) => string) {
  const doPosto = bipesAte(t).filter((b) => b.posto.toLowerCase() === posto.toLowerCase())
  const entradas = doPosto.filter((b) => b.status === '').map((b) => ({ sn: b.sn, dataHora: minutoParaIso(b.minuto) }))
  const saidas = doPosto.filter((b) => b.status !== '').map((b) => ({ sn: b.sn, dataHora: minutoParaIso(b.minuto), status: b.status }))
  const emAndamento: { sn: string; desde: string }[] = []
  for (const [sn, regs] of porPeca(doPosto)) {
    const ciclos = pareaBurnin(regs.map((b) => ({ dataHora: minutoParaIso(b.minuto), status: b.status })))
    const ultimo = ciclos[ciclos.length - 1]
    if (estaAberto(ciclos) && ultimo) emAndamento.push({ sn, desde: ultimo.entrada })
  }
  return {
    emAndamento: emAndamento.sort((a, b) => a.desde.localeCompare(b.desde)),
    entradas: entradas.reverse(),
    saidas: saidas.reverse(),
  }
}

export { recursoDe as recursoDoPostoDemo, temStatusDe as temStatusDoPostoDemo, exigeManutencaoDe as exigeManutencaoDemo }
