export const MANUTENCAO = 'Manutenção'
export const ENTRADA = 'Entrada'
export const SAIDA = 'Saída'
const ESPACO_X = 300 // folga entre postos pra o rótulo de tempo na aresta não ficar coberto pelo card
const ESPACO_Y = 200 // altura entre as linhas da serpentina (card ~116px + folga pro traçado)
const POR_LINHA = 3 // postos por linha antes de "quebrar" — evita a fileira longa que não cabe na tela

/**
 * Posição do índice `i` no arranjo SERPENTINA: a 1ª linha vai da esquerda pra direita, a 2ª volta da
 * direita pra esquerda, e assim por diante. Postos consecutivos ficam sempre vizinhos (sem linha de
 * retorno atravessando a tela). Com ≤ POR_LINHA postos, o resultado é a fileira única de antes.
 */
function posSerpentina(i: number): { x: number; y: number } {
  const linha = Math.floor(i / POR_LINHA)
  const col = i % POR_LINHA
  const x = (linha % 2 === 0 ? col : POR_LINHA - 1 - col) * ESPACO_X
  return { x, y: linha * ESPACO_Y }
}

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
  /** PEÇAS DISTINTAS que passaram (SN cujo último registro no posto ≠ reprovado). Base do card/concluído.
   *  Opcional: quando ausente (dados antigos/testes), cai no bipe-count (temStatus?aprovadas:registros). */
  passouDistinto?: number
  /** 1º registro no posto (ISO) — pra a cadência MACRO (minutos úteis desde o início da produção ali). */
  primeiroEm?: string | null
  /** Último registro no posto (ISO) — fim da janela macro. */
  ultimoEm?: string | null
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
  /** Só na caixa de Entrada: OP (injetado pela tela). */
  op?: string
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
  const wip = a?.wip ?? 0
  // "Passou" = PEÇAS DISTINTAS que passaram (passouDistinto; ≤ qtd). Corrige o card mostrar >qtd (ex.: 1457/1410),
  // pois aprovadas/registros contam BIPES (reteste soma). Fallback pro bipe-count quando passouDistinto ausente.
  // "Concluído" = passou ≥ qtd E NENHUMA pendente aqui (wip === 0). Manutenção é ramo, não conclui.
  const passou = a?.passouDistinto ?? (temStatus ? aprovadas : registros)
  const concluido = !ehManutencao && wip === 0 && qtd != null && qtd > 0 && passou >= qtd
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
    primeiroEm: a?.primeiroEm ?? null,
    ultimoEm: a?.ultimoEm ?? null,
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
  // Posto FORA do fluxo da OP — na prática, MANUTENÇÃO: a peça reprovou, foi pra lá e o reparo já
  // foi registrado; ela ainda precisa VOLTAR. Isto estava junto com o "último posto" no mesmo
  // `return null`, então a peça contava como FINALIZADA e ainda sumia da fila da Manutenção
  // (o WIP de cada nó é justamente esta contagem). Aguardando onde está é a leitura honesta.
  if (idx < 0) return ultimo.posto
  if (idx >= postosOrdenados.length - 1) return null // último posto do fluxo → concluída
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
    ...posSerpentina(i),
    data: dados(posto, agregados, temStatus(posto), false, recursoDe(posto), qtd),
  }))

  // Manutenção fica UMA linha abaixo da última da serpentina, centralizada na largura usada.
  const linhas = postosOrdenados.length > 0 ? Math.ceil(postosOrdenados.length / POR_LINHA) : 0
  const largura = Math.min(postosOrdenados.length, POR_LINHA)
  const xManut = largura > 0 ? ((largura - 1) * ESPACO_X) / 2 : 0
  nodes.push({
    id: MANUTENCAO,
    x: xManut,
    y: linhas * ESPACO_Y,
    data: dados(MANUTENCAO, agregados, false, true, 'manutencao', qtd),
  })

  // Caixas de Entrada/Saída (só quando há postos e a contagem foi informada).
  // Entrada fica ANTES do 1º posto; Saída continua a serpentina (posição do índice seguinte ao último).
  const temCaixas = postosOrdenados.length > 0
  if (temCaixas && naoIniciadas != null) {
    nodes.push({ id: ENTRADA, x: -ESPACO_X, y: 0, data: dadosCaixa(ENTRADA, naoIniciadas, 'entrada') })
  }
  if (temCaixas && finalizadas != null) {
    nodes.push({ id: SAIDA, ...posSerpentina(postosOrdenados.length), data: dadosCaixa(SAIDA, finalizadas, 'saida') })
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
