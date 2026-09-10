export interface RegistroContagem {
  posto: string
  status: string
}

/** Contagem por posto (fluxo da OP + Manutenção): sem-status conta registros; com-status conta aprovados. */
export function contarPorPosto(
  postosDaOp: string[],
  registros: RegistroContagem[],
  temStatus: (posto: string) => boolean,
): Record<string, number> {
  const colunas = [...postosDaOp, 'Manutenção']
  const contagens: Record<string, number> = {}
  for (const p of colunas) contagens[p] = 0
  for (const r of registros) {
    const coluna = colunas.find((c) => c.toLowerCase() === r.posto.toLowerCase())
    if (!coluna) continue
    if (temStatus(coluna)) {
      if (r.status.toLowerCase() === 'aprovado') contagens[coluna] = (contagens[coluna] ?? 0) + 1
    } else {
      contagens[coluna] = (contagens[coluna] ?? 0) + 1
    }
  }
  return contagens
}

// ---------------------------------------------------------------------------
// Dashboard geral (várias OPs) — substitui o relatório do Looker Studio
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
}

/** O padrão que a tela abre: OPs em aberto, sem recorte de data — tudo desde que a OP começou. */
export const FILTRO_PADRAO: FiltroDashboard = {
  cliente: '', pmo: '', op: '', statusOp: 'aberta', de: '', ate: '', posto: '',
}

/** Uma linha crua da grade: um par (OP, posto) com as contagens daquele posto. */
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
  pecas: number
}

/** Uma OP na tabela, já com as colunas de posto resolvidas. */
export interface OpDaGrade {
  pmo: string
  op: string
  cliente: string
  descricao: string
  qtdOp: number | null
  finalizada: boolean
  /** posto → contagens. Posto que a OP não tem simplesmente não aparece aqui. */
  porPosto: Record<string, { aprovados: number; reprovados: number; pecas: number }>
}

export interface GradeDashboard {
  ops: OpDaGrade[]
  /** Todos os postos que apareceram, na ordem em que devem virar coluna. */
  postos: string[]
}

/**
 * Pivota as linhas (OP, posto) numa tabela OP × posto.
 *
 * O banco devolve formato LONGO — uma linha por par — porque é o que uma agregação SQL produz
 * naturalmente e o que sobrevive à paginação por OP. A tabela precisa do formato LARGO, e a lista
 * de colunas só se conhece depois de ver os dados: cada OP tem o seu fluxo, e a união deles é que
 * forma o cabeçalho.
 *
 * As colunas saem na ordem de `postosConhecidos` (a ordem do fluxo, vinda do cadastro de postos);
 * qualquer posto fora dessa lista vai pro fim, em ordem alfabética, em vez de sumir — posto
 * renomeado ou registro antigo continua visível.
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
        qtdOp: l.qtdOp, finalizada: l.finalizada, porPosto: {},
      }
      porOp.set(chave, alvo)
    }
    if (l.posto.trim() === '') continue
    vistos.add(l.posto)
    alvo.porPosto[l.posto] = { aprovados: l.aprovados, reprovados: l.reprovados, pecas: l.pecas }
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

export interface DefeitoDashboard {
  codigo: string
  total: number
}

/** Tudo que a tela desenha, numa foto só do mesmo filtro. */
export interface DadosDashboard {
  totais: TotaisDashboard
  grade: GradeDashboard
  opsTotal: number
  defeitos: { topo: DefeitoDashboard[]; outros: number }
}
