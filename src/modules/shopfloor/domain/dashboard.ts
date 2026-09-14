export interface RegistroContagem {
  posto: string
  status: string
  /** Nº de série normalizado — a contagem é por PEÇA, então o mesmo SN conta uma vez por posto. */
  sn: string
}

/**
 * Peças por posto da OP (fluxo + Manutenção) — a aba "Por OP".
 * Posto com status conta as peças APROVADAS nele; posto sem status (e a Manutenção) conta as peças
 * que passaram por ele. Peça, não bipe: um reteste ou os vários registros de um reparo na
 * Manutenção não inflam a coluna — mesma régua da aba Geral e do "Contar diferentes" do legado.
 */
export function contarPorPosto(
  postosDaOp: string[],
  registros: RegistroContagem[],
  temStatus: (posto: string) => boolean,
): Record<string, number> {
  const colunas = [...postosDaOp, 'Manutenção']
  const pecas = new Map<string, Set<string>>(colunas.map((c) => [c, new Set<string>()]))
  for (const r of registros) {
    const coluna = colunas.find((c) => c.toLowerCase() === r.posto.toLowerCase())
    if (!coluna || r.sn === '') continue
    if (temStatus(coluna) && r.status.toLowerCase() !== 'aprovado') continue
    pecas.get(coluna)!.add(r.sn)
  }
  return Object.fromEntries(colunas.map((c) => [c, pecas.get(c)!.size]))
}

// ---------------------------------------------------------------------------
// Dashboard geral (várias OPs) — métricas do relatório legado do Looker Studio (migração 0101)
// ---------------------------------------------------------------------------

/** Filtro que a tela inteira compartilha. Vazio = "todos"; datas vazias = sem recorte. */
export interface FiltroDashboard {
  cliente: string
  pmo: string
  op: string
  /** '' = todas · 'aberta' = OPs não finalizadas (padrão) · 'finalizada' */
  statusOp: '' | 'aberta' | 'finalizada'
  de: string
  ate: string
  posto: string
  colaborador: string
  /** Nº de série como digitado — a aplicação normaliza antes de mandar pro banco. */
  sn: string
}

/** O padrão da tela: só as OPs ativas, sem data e sem nenhum outro recorte. */
export const FILTRO_PADRAO: FiltroDashboard = {
  cliente: '', pmo: '', op: '', statusOp: 'aberta', de: '', ate: '', posto: '', colaborador: '', sn: '',
}

/** Uma linha crua da tabela: um par (OP, posto) com as peças daquele posto por status. */
export interface LinhaGrade {
  pmo: string
  op: string
  cliente: string
  descricao: string
  qtdOp: number | null
  finalizada: boolean
  posto: string
  aprovados: number
  reprovados: number
  semStatus: number
  /** Peças distintas da OP inteira no recorte — é o que ordena as linhas. */
  pecasOp: number
}

export interface CelulaGrade {
  aprovados: number
  reprovados: number
  semStatus: number
}

/** Uma OP na tabela, já com as colunas de posto resolvidas. */
export interface OpDaGrade {
  pmo: string
  op: string
  cliente: string
  descricao: string
  qtdOp: number | null
  finalizada: boolean
  pecas: number
  /** posto → peças por status. Posto sem bipe da OP simplesmente não aparece aqui. */
  porPosto: Record<string, CelulaGrade>
}

export interface GradeDashboard {
  ops: OpDaGrade[]
  /** Todos os postos que apareceram, na ordem em que devem virar coluna. */
  postos: string[]
}

/**
 * Pivota as linhas (OP, posto) numa tabela OP × posto.
 *
 * O banco devolve formato LONGO — uma linha por par — porque é o que uma agregação SQL produz e o
 * que sobrevive à paginação por OP. A ordem das OPs é a do banco (mais peças primeiro, como no
 * legado); a das colunas é a do cadastro de postos, com posto fora do cadastro no fim, em ordem
 * alfabética, em vez de sumir — posto renomeado ou registro antigo continua visível.
 */
export function pivotarGrade(
  linhas: readonly LinhaGrade[],
  postosConhecidos: readonly string[],
): GradeDashboard {
  const porOp = new Map<string, OpDaGrade>()
  const vistos = new Set<string>()

  for (const l of linhas) {
    const chave = `${l.pmo}|${l.op}`
    let alvo = porOp.get(chave)
    if (!alvo) {
      alvo = {
        pmo: l.pmo, op: l.op, cliente: l.cliente, descricao: l.descricao,
        qtdOp: l.qtdOp, finalizada: l.finalizada, pecas: l.pecasOp, porPosto: {},
      }
      porOp.set(chave, alvo)
    }
    if (l.posto.trim() === '') continue
    vistos.add(l.posto)
    alvo.porPosto[l.posto] = { aprovados: l.aprovados, reprovados: l.reprovados, semStatus: l.semStatus }
  }

  const ordem = new Map(postosConhecidos.map((p, i) => [p, i]))
  const postos = [...vistos].sort((a, b) => {
    const ia = ordem.get(a), ib = ordem.get(b)
    if (ia !== undefined && ib !== undefined) return ia - ib
    if (ia !== undefined) return -1   // conhecido antes de desconhecido
    if (ib !== undefined) return 1
    return a.localeCompare(b, 'pt-BR')
  })

  return { ops: [...porOp.values()], postos }
}

/** Quantas OPs por página. Cada OP é uma linha larga (uma coluna por posto) — 20 já enche a tela. */
export const OPS_POR_PAGINA = 20

export interface TotaisDashboard {
  /** PEÇAS distintas, não bipes — a mesma régua do relatório antigo. */
  total: number
  aprovado: number
  reprovado: number
  ops: number
  bipes: number
}

export interface ItemRanking {
  rotulo: string
  valor: number
}

/** Os N maiores + o resto somado — o "Agrupar o restante como Outros" do Looker. */
export interface Ranking {
  topo: ItemRanking[]
  outros: number
}

export interface OpPorStatus {
  pmo: string
  op: string
  total: number
  porStatus: Record<string, number>
}

export interface GraficosDashboard {
  status: Ranking
  tipo: Ranking
  defeitos: Ranking
  posicoes: Ranking
  ops: OpPorStatus[]
}

/** Tudo que a tela desenha, numa foto só do mesmo filtro. */
export interface DadosDashboard {
  totais: TotaisDashboard
  grade: GradeDashboard
  opsTotal: number
  graficos: GraficosDashboard
}

export const RANKING_VAZIO: Ranking = { topo: [], outros: 0 }

/**
 * "Como é calculado" de cada número da tela — o texto do hover. Mora no domínio, perto das regras,
 * pra quem mudar uma conta enxergar a explicação que tem que mudar junto. Espelha a 0101.
 */
export const COMO_CALCULA = {
  total:
    'Peças diferentes (nº de série contado uma vez só) com pelo menos um bipe no filtro, em qualquer posto e com qualquer status.',
  aprovado:
    'Peças diferentes com pelo menos um bipe Aprovado no filtro, em qualquer posto. Uma peça reprovada e aprovada depois do reparo conta aqui e em Reprovado.',
  reprovado:
    'Peças diferentes com pelo menos um bipe Reprovado no filtro, em qualquer posto. Uma peça reprovada e aprovada depois do reparo conta aqui e em Aprovado.',
  soma:
    'Aprovado + Reprovado não fecha com o Total: peças que só passaram por postos sem status (Printer, Montagem PTH) ficam fora dos dois, e uma peça aprovada num posto e reprovada em outro conta nos dois.',
  grade:
    'Peças diferentes da OP em cada posto, separadas pelo status do bipe: aprovadas, reprovadas e sem status (postos de passagem e Manutenção). A mesma peça pode aparecer em mais de um status. OPs com mais peças primeiro.',
  status:
    'Registros: cada bipe com status conta uma vez, então a mesma peça bipada em três postos conta três. Bipes sem status ficam de fora. Por isso difere dos cartões, que contam peças.',
  tipo:
    'Registros de reprova por tipo de componente (SMD, PTH…). Só a reprova conta: os consertos e defeitos constatados na Manutenção repetem o tipo e ficariam contados em dobro. Os 10 maiores; o resto soma em Outros.',
  ops:
    'Registros com status por OP (cada bipe Aprovado ou Reprovado conta uma vez). As 10 OPs com mais registros.',
  defeitos:
    'Reprovas por código de defeito. Só a reprova conta: os consertos e defeitos constatados na Manutenção repetem o código e ficariam contados em dobro. Os 6 maiores; o resto soma em Outros.',
  posicoes:
    'Reprovas por posição do defeito (H1, R5…), só as que têm tipo de componente. Os consertos da Manutenção não contam. As 15 maiores; o resto soma em Outros.',
} as const
