export const MANUTENCAO = 'Manutenção'
const ESPACO_X = 260
const Y_MANUTENCAO = 220

export interface FluxoAgregado {
  posto: string
  wip: number
  registros: number
  aprovadas: number
  reprovadas: number
  retestes: number
}

export interface FluxoNodeData extends FluxoAgregado {
  ehManutencao: boolean
  temStatus: boolean
  /** Recurso do perfil do posto (nenhum/caixa/nqa/integracao/burnin/manutencao) — define o ícone. */
  recurso: string
  /** Todas as peças da OP já passaram por este posto (passou ≥ qtd da OP). Manutenção nunca conclui. */
  concluido: boolean
}

export interface FluxoNodePos {
  id: string
  x: number
  y: number
  data: FluxoNodeData
}

export interface FluxoEdge {
  id: string
  source: string
  target: string
  tipo: 'fluxo' | 'reprova'
}

function acharAgg(agregados: FluxoAgregado[], posto: string): FluxoAgregado | undefined {
  const alvo = posto.toLowerCase()
  return agregados.find((a) => a.posto.toLowerCase() === alvo)
}

/** Um registro cru de passagem de uma peça por um posto (entrada de `numerarPassagens`). */
export interface RegistroPassagem {
  chave: string // SN normalizado (agrupa a mesma peça)
  sn: string // SN pra exibir
  status: string
  dataHora: string // ISO — ordem cronológica
  ordem: number // desempate estável quando a dataHora empata (ex.: id do registro)
}

/** Uma passagem numerada de uma peça por um posto (saída de `numerarPassagens`). */
export interface PassagemPosto {
  sn: string
  status: string
  ordinal: number // 1 = 1ª vez, 2 = 2ª vez…
  total: number // quantas vezes a peça passou no posto (1 = passou só uma vez)
}

/**
 * Expande as passagens de UM posto por peça, numeradas em ordem cronológica (1x, 2x…). Puro.
 * Agrupa por `chave`, ordena por (dataHora, ordem) dentro da peça e numera; devolve a lista
 * achatada ordenada por SN e depois pela ordem cronológica. Quem passou 1 vez tem total=1.
 */
export function numerarPassagens(registros: RegistroPassagem[]): PassagemPosto[] {
  const porPeca = new Map<string, RegistroPassagem[]>()
  for (const r of registros) {
    const arr = porPeca.get(r.chave)
    if (arr) arr.push(r)
    else porPeca.set(r.chave, [r])
  }
  const res: PassagemPosto[] = []
  for (const arr of porPeca.values()) {
    const asc = [...arr].sort((a, b) => a.dataHora.localeCompare(b.dataHora) || a.ordem - b.ordem)
    const total = asc.length
    asc.forEach((r, i) => res.push({ sn: r.sn, status: r.status, ordinal: i + 1, total }))
  }
  return res.sort((a, b) => a.sn.localeCompare(b.sn) || a.ordinal - b.ordinal)
}

function dados(
  posto: string,
  agregados: FluxoAgregado[],
  temStatus: boolean,
  ehManutencao: boolean,
  recurso: string,
  qtd: number | null,
): FluxoNodeData {
  const a = acharAgg(agregados, posto)
  const aprovadas = a?.aprovadas ?? 0
  const registros = a?.registros ?? 0
  // "Concluído" = todas as peças da OP já passaram por aqui (aprovadas p/ posto com status; registros p/ sem).
  // Manutenção é ramo, não conclui.
  const passou = temStatus ? aprovadas : registros
  const concluido = !ehManutencao && qtd != null && qtd > 0 && passou >= qtd
  return {
    posto,
    wip: a?.wip ?? 0,
    registros,
    aprovadas,
    reprovadas: a?.reprovadas ?? 0,
    retestes: a?.retestes ?? 0,
    temStatus,
    ehManutencao,
    recurso,
    concluido,
  }
}

/** Monta nós/arestas do canvas a partir da ordem do fluxo + agregados da RPC. Puro. */
export function construirFluxo(
  postosOrdenados: string[],
  agregados: FluxoAgregado[],
  temStatus: (posto: string) => boolean,
  recursoDe: (posto: string) => string = () => 'nenhum',
  qtd: number | null = null,
  // Só liga na Manutenção o posto que ROTEIA pra lá (exigeManutencao). Postos que reprovam mas
  // fazem conserto no próprio posto (SPI/Inspeção: reprova≠nenhum && !exigeManutencao) não ligam.
  // Default `true` preserva o comportamento antigo p/ chamadas que não informam.
  exigeManutencaoDe: (posto: string) => boolean = () => true,
): { nodes: FluxoNodePos[]; edges: FluxoEdge[] } {
  const nodes: FluxoNodePos[] = postosOrdenados.map((posto, i) => ({
    id: posto,
    x: i * ESPACO_X,
    y: 0,
    data: dados(posto, agregados, temStatus(posto), false, recursoDe(posto), qtd),
  }))

  const xManut = postosOrdenados.length > 0 ? ((postosOrdenados.length - 1) * ESPACO_X) / 2 : 0
  nodes.push({
    id: MANUTENCAO,
    x: xManut,
    y: Y_MANUTENCAO,
    data: dados(MANUTENCAO, agregados, false, true, 'manutencao', qtd),
  })

  const edges: FluxoEdge[] = []
  for (let i = 0; i < postosOrdenados.length - 1; i++) {
    const source = postosOrdenados[i]!
    const target = postosOrdenados[i + 1]!
    edges.push({ id: `f:${source}->${target}`, source, target, tipo: 'fluxo' })
  }
  for (const posto of postosOrdenados) {
    if ((acharAgg(agregados, posto)?.reprovadas ?? 0) > 0 && exigeManutencaoDe(posto)) {
      edges.push({ id: `r:${posto}`, source: posto, target: MANUTENCAO, tipo: 'reprova' })
    }
  }
  return { nodes, edges }
}
