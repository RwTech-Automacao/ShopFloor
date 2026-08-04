export const MANUTENCAO = 'Manutenção'
const ESPACO_X = 220
const Y_MANUTENCAO = 180

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

function dados(posto: string, agregados: FluxoAgregado[], temStatus: boolean, ehManutencao: boolean): FluxoNodeData {
  const a = acharAgg(agregados, posto)
  return {
    posto,
    wip: a?.wip ?? 0,
    registros: a?.registros ?? 0,
    aprovadas: a?.aprovadas ?? 0,
    reprovadas: a?.reprovadas ?? 0,
    retestes: a?.retestes ?? 0,
    temStatus,
    ehManutencao,
  }
}

/** Monta nós/arestas do canvas a partir da ordem do fluxo + agregados da RPC. Puro. */
export function construirFluxo(
  postosOrdenados: string[],
  agregados: FluxoAgregado[],
  temStatus: (posto: string) => boolean,
): { nodes: FluxoNodePos[]; edges: FluxoEdge[] } {
  const nodes: FluxoNodePos[] = postosOrdenados.map((posto, i) => ({
    id: posto,
    x: i * ESPACO_X,
    y: 0,
    data: dados(posto, agregados, temStatus(posto), false),
  }))

  const xManut = postosOrdenados.length > 0 ? ((postosOrdenados.length - 1) * ESPACO_X) / 2 : 0
  nodes.push({
    id: MANUTENCAO,
    x: xManut,
    y: Y_MANUTENCAO,
    data: dados(MANUTENCAO, agregados, false, true),
  })

  const edges: FluxoEdge[] = []
  for (let i = 0; i < postosOrdenados.length - 1; i++) {
    const source = postosOrdenados[i]!
    const target = postosOrdenados[i + 1]!
    edges.push({ id: `f:${source}->${target}`, source, target, tipo: 'fluxo' })
  }
  for (const posto of postosOrdenados) {
    if ((acharAgg(agregados, posto)?.reprovadas ?? 0) > 0) {
      edges.push({ id: `r:${posto}`, source: posto, target: MANUTENCAO, tipo: 'reprova' })
    }
  }
  return { nodes, edges }
}
