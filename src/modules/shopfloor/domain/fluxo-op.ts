export const MANUTENCAO = 'Manutenção'
export const ENTRADA = 'Entrada'
export const SAIDA = 'Saída'
const ESPACO_X = 300 // folga entre postos pra o rótulo de tempo na aresta não ficar coberto pelo card
const Y_MANUTENCAO = 220

export interface FluxoAgregado {
  posto: string
  wip: number
  registros: number
  aprovadas: number
  reprovadas: number
  retestes: number
  /** Peças cuja 1ª passagem no posto foi aprovada (first-pass yield). Só faz sentido em posto com status. */
  aprovadosPrimeira: number
  /** Peças cujo último registro no posto é reprovado (reprovou e ainda não re-aprovou). Saldo pendente. */
  reprovadosSemReteste: number
}

export interface FluxoNodeData extends FluxoAgregado {
  ehManutencao: boolean
  temStatus: boolean
  /** Recurso do perfil do posto (nenhum/caixa/nqa/integracao/burnin/manutencao) — define o ícone. */
  recurso: string
  /** Todas as peças da OP já passaram por este posto (passou ≥ qtd da OP). Manutenção nunca conclui. */
  concluido: boolean
  /** Caixa de Entrada (peças que ainda não começaram). Renderiza em vinho, sem detalhe ao clicar. */
  ehEntrada?: boolean
  /** Caixa de Saída (peças que concluíram todo o fluxo). Renderiza em vinho, sem detalhe ao clicar. */
  ehSaida?: boolean
  /** Já passaram por este posto (aprovadas p/ posto com status; registros p/ sem). Mesmo valor que deriva `concluido`. */
  passou: number
  /** Quantas devem passar (qtd da OP). null = OP sem quantidade (card não mostra "/ devem passar" nem a barra). */
  devemPassar: number | null
  /** Só na caixa de Entrada: PMO da OP (injetado pela tela, não pelo domínio). */
  pmo?: string
  /** Só na caixa de Entrada: descrição da OP (a tela corta em ≤20 chars ao exibir). */
  descricao?: string
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
  /** Tempo típico (mediana, segundos) que a peça leva no trajeto origem→destino. Só arestas de cadeia. */
  segundos?: number
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
 * Dentro de cada peça as passagens ficam em ordem cronológica; as PEÇAS são ordenadas pela
 * passagem MAIS RECENTE primeiro (peça que bipou por último aparece no topo). Quem passou 1
 * vez tem total=1.
 */
export function numerarPassagens(registros: RegistroPassagem[]): PassagemPosto[] {
  const porPeca = new Map<string, RegistroPassagem[]>()
  for (const r of registros) {
    const arr = porPeca.get(r.chave)
    if (arr) arr.push(r)
    else porPeca.set(r.chave, [r])
  }
  const grupos = [...porPeca.values()].map((arr) =>
    [...arr].sort((a, b) => a.dataHora.localeCompare(b.dataHora) || a.ordem - b.ordem),
  )
  // peças ordenadas pela última passagem (mais recente primeiro).
  grupos.sort((g1, g2) => {
    const u1 = g1[g1.length - 1]
    const u2 = g2[g2.length - 1]
    if (!u1 || !u2) return 0
    return u2.dataHora.localeCompare(u1.dataHora) || u2.ordem - u1.ordem
  })
  const res: PassagemPosto[] = []
  for (const asc of grupos) {
    const total = asc.length
    asc.forEach((r, i) => res.push({ sn: r.sn, status: r.status, ordinal: i + 1, total }))
  }
  return res
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
    aprovadosPrimeira: a?.aprovadosPrimeira ?? 0,
    reprovadosSemReteste: a?.reprovadosSemReteste ?? 0,
    temStatus,
    ehManutencao,
    recurso,
    concluido,
    passou,
    devemPassar: qtd,
  }
}

/** Dados de uma caixa de Entrada/Saída (nó sintético, vinho, só com a contagem). */
function dadosCaixa(id: string, contagem: number, tipo: 'entrada' | 'saida'): FluxoNodeData {
  return {
    posto: id,
    wip: contagem,
    registros: 0,
    aprovadas: 0,
    reprovadas: 0,
    retestes: 0,
    aprovadosPrimeira: 0,
    reprovadosSemReteste: 0,
    temStatus: false,
    ehManutencao: false,
    recurso: tipo,
    concluido: false,
    ehEntrada: tipo === 'entrada',
    ehSaida: tipo === 'saida',
    passou: 0,
    devemPassar: null,
  }
}

/** Um bipe cru de uma peça, em ordem cronológica (pra decidir onde ela está pendente). */
export interface BipePeca {
  posto: string
  status: string // '' = passagem OU entrada de Burn-in; 'Aprovado'/'Reprovado' = status/saída
  postoRetorno?: string // NQA: caixa reprovada → posto escolhido p/ voltar (roteia a reprova)
}

/**
 * Onde a peça está AGUARDANDO (a fila), a partir do histórico cronológico + a ordem dos postos. Puro.
 * - aprovada/passagem/saída-de-burn-in-aprovada → PRÓXIMO posto (ou null = concluída, se era o último)
 * - reprovada → MANUTENCAO (se o posto exige) ou o PRÓPRIO posto (conserto no lugar)
 * - Burn-in entrada (status vazio num posto de recurso 'burnin') → o próprio Burn-in (cozinhando)
 * - sem bipe → o 1º posto
 * Devolve o nome do posto, MANUTENCAO, ou null (concluída).
 */
export function postoPendenteDePeca(
  registrosCrono: BipePeca[],
  postosOrdenados: string[],
  exigeManutencaoDe: (posto: string) => boolean,
  recursoDe: (posto: string) => string,
): string | null {
  const ultimo = registrosCrono[registrosCrono.length - 1]
  if (!ultimo) return postosOrdenados[0] ?? null
  const st = ultimo.status.trim().toLowerCase()
  // Reteste do NQA: `postoRetorno` traz a lista restante de postos a repassar (+ NQA no fim); o
  // reteste PROPAGA a lista, então pendente = 1º da lista SEJA QUAL FOR o status (reprovado na
  // reprova; aprovado/passagem nos repasses seguintes).
  if (ultimo.postoRetorno && ultimo.postoRetorno.trim() !== '') {
    return ultimo.postoRetorno.split(',')[0]!.trim()
  }
  if (st === 'reprovado') return exigeManutencaoDe(ultimo.posto) ? MANUTENCAO : ultimo.posto
  if (st === '' && recursoDe(ultimo.posto) === 'burnin') return ultimo.posto // entrada = cozinhando aqui
  const idx = postosOrdenados.findIndex((p) => p.toLowerCase() === ultimo.posto.toLowerCase())
  if (idx < 0 || idx >= postosOrdenados.length - 1) return null // posto desconhecido ou último → concluída
  return postosOrdenados[idx + 1] ?? null
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
  // Caixas de Entrada (peças que não começaram) e Saída (peças que concluíram o fluxo). null = não mostra.
  naoIniciadas: number | null = null,
  finalizadas: number | null = null,
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

  // Caixas de Entrada/Saída (só quando há postos e a contagem foi informada).
  const temCaixas = postosOrdenados.length > 0
  if (temCaixas && naoIniciadas != null) {
    nodes.push({ id: ENTRADA, x: -ESPACO_X, y: 0, data: dadosCaixa(ENTRADA, naoIniciadas, 'entrada') })
  }
  if (temCaixas && finalizadas != null) {
    nodes.push({ id: SAIDA, x: postosOrdenados.length * ESPACO_X, y: 0, data: dadosCaixa(SAIDA, finalizadas, 'saida') })
  }

  const edges: FluxoEdge[] = []
  if (temCaixas && naoIniciadas != null) {
    edges.push({ id: `f:${ENTRADA}->${postosOrdenados[0]!}`, source: ENTRADA, target: postosOrdenados[0]!, tipo: 'fluxo' })
  }
  for (let i = 0; i < postosOrdenados.length - 1; i++) {
    const source = postosOrdenados[i]!
    const target = postosOrdenados[i + 1]!
    edges.push({ id: `f:${source}->${target}`, source, target, tipo: 'fluxo' })
  }
  if (temCaixas && finalizadas != null) {
    const ultimo = postosOrdenados[postosOrdenados.length - 1]!
    edges.push({ id: `f:${ultimo}->${SAIDA}`, source: ultimo, target: SAIDA, tipo: 'fluxo' })
  }
  for (const posto of postosOrdenados) {
    if ((acharAgg(agregados, posto)?.reprovadas ?? 0) > 0 && exigeManutencaoDe(posto)) {
      edges.push({ id: `r:${posto}`, source: posto, target: MANUTENCAO, tipo: 'reprova' })
    }
  }
  return { nodes, edges }
}

/**
 * Formata uma duração (em segundos) como relógio:
 *   ≥ 1h  → HH:MM:SS (ex.: 02:03:04)
 *   < 1h  → MM:SS    (ex.: 05:30, e 45s vira 00:45)
 */
export function formatarRelogio(segundos: number): string {
  const s = Math.max(0, Math.round(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}
