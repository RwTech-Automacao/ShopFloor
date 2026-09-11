import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarSerie } from '../domain/serie'
import {
  RANKING_VAZIO,
  type RegistroContagem, type FiltroDashboard, type LinhaGrade, type TotaisDashboard,
  type GraficosDashboard, type Ranking, type OpPorStatus,
} from '../domain/dashboard'

const PAGINA = 1000

/** Registros (posto,status,SN) da OP, com período opcional (datas YYYY-MM-DD, fuso -03:00). Paginado. */
export async function listarContagemDaOp(
  pmo: string,
  op: string,
  de?: string,
  ate?: string,
): Promise<RegistroContagem[]> {
  const supabase = await createServerSupabase()
  const out: RegistroContagem[] = []
  for (let ini = 0; ; ini += PAGINA) {
    let q = supabase
      .from('sf_registros')
      .select('posto,status,numero_serie_norm')
      .eq('pmo', pmo)
      .eq('op', op)
      .order('id', { ascending: true })
      .range(ini, ini + PAGINA - 1)
    if (de) q = q.gte('data_hora', `${de}T00:00:00-03:00`)
    if (ate) q = q.lte('data_hora', `${ate}T23:59:59-03:00`)
    const { data, error } = await q
    if (error) throw error
    const rows = data as { posto: string; status: string; numero_serie_norm: string }[]
    out.push(...rows.map((r) => ({ posto: r.posto, status: r.status, sn: r.numero_serie_norm ?? '' })))
    if (rows.length < PAGINA) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Dashboard geral (várias OPs) — tudo agregado no banco (migração 0101)
// ---------------------------------------------------------------------------

/**
 * Converte o filtro da tela nos parâmetros das RPCs.
 *
 * As datas vêm dos inputs como YYYY-MM-DD e viram o DIA INTEIRO no fuso de produção — quem escolhe
 * "até 10/09" espera o dia 10 inteiro. O SN é normalizado aqui, igual ao que o bipe grava.
 */
function paramsDoFiltro(f: FiltroDashboard) {
  return {
    p_cliente: f.cliente.trim(),
    p_pmo: f.pmo.trim(),
    p_op: f.op.trim(),
    p_status_op: f.statusOp,
    p_de: f.de ? `${f.de}T00:00:00-03:00` : null,
    p_ate: f.ate ? `${f.ate}T23:59:59-03:00` : null,
    p_posto: f.posto.trim(),
    p_colaborador: f.colaborador.trim(),
    p_sn: f.sn.trim() ? normalizarSerie(f.sn) : '',
  }
}

export async function carregarTotaisDashboard(f: FiltroDashboard): Promise<TotaisDashboard> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_dashboard_totais', paramsDoFiltro(f))
  if (error) throw error
  const v = (data ?? {}) as Partial<TotaisDashboard>
  return {
    total: v.total ?? 0, aprovado: v.aprovado ?? 0, reprovado: v.reprovado ?? 0,
    ops: v.ops ?? 0, bipes: v.bipes ?? 0,
  }
}

/** Linhas (OP, posto) da página + quantas OPs o filtro tem no total (pra montar a paginação). */
export async function carregarGradeDashboard(
  f: FiltroDashboard, limite: number, offset: number,
): Promise<{ linhas: LinhaGrade[]; opsTotal: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_dashboard_grade', {
    ...paramsDoFiltro(f), p_limite: limite, p_offset: offset,
  })
  if (error) throw error
  type Row = {
    pmo: string; op: string; cliente: string; descricao: string; qtd_op: number | null
    finalizada: boolean; posto: string; aprovados: number; reprovados: number; sem_status: number
    pecas_op: number; ops_total: number
  }
  const rows = (data ?? []) as Row[]
  return {
    linhas: rows.map((r) => ({
      pmo: r.pmo, op: r.op, cliente: r.cliente ?? '', descricao: r.descricao ?? '',
      qtdOp: r.qtd_op, finalizada: r.finalizada === true, posto: r.posto ?? '',
      aprovados: r.aprovados ?? 0, reprovados: r.reprovados ?? 0, semStatus: r.sem_status ?? 0,
      pecasOp: r.pecas_op ?? 0,
    })),
    // `ops_total` viaja repetido em toda linha (result set único do PostgREST); 0 quando não há linha.
    opsTotal: rows[0]?.ops_total ?? 0,
  }
}

function lerRanking(v: unknown): Ranking {
  const r = v as Partial<Ranking> | null | undefined
  if (!r) return RANKING_VAZIO
  return {
    topo: (r.topo ?? []).map((i) => ({ rotulo: String(i.rotulo ?? ''), valor: Number(i.valor) || 0 })),
    outros: Number(r.outros) || 0,
  }
}

/** Status, tipo, OPs por status, defeitos e posições — a mesma foto do filtro, num jsonb só. */
export async function carregarGraficosDashboard(f: FiltroDashboard): Promise<GraficosDashboard> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_dashboard_graficos', paramsDoFiltro(f))
  if (error) throw error
  const v = (data ?? {}) as Record<string, unknown>
  const ops = ((v.ops ?? []) as Partial<OpPorStatus>[]).map((o) => ({
    pmo: String(o.pmo ?? ''), op: String(o.op ?? ''), total: Number(o.total) || 0,
    porStatus: Object.fromEntries(Object.entries(o.porStatus ?? {}).map(([k, n]) => [k, Number(n) || 0])),
  }))
  return {
    status: lerRanking(v.status),
    tipo: lerRanking(v.tipo),
    defeitos: lerRanking(v.defeitos),
    posicoes: lerRanking(v.posicoes),
    ops,
  }
}

/** Opções do filtro de Colaborador: uma por pessoa, sem diferenciar maiúsculas (grafia mais usada). */
export async function listarColaboradoresDashboard(): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_dashboard_colaboradores')
  if (error) throw error
  return ((data ?? []) as { nome: string }[]).map((r) => r.nome).filter(Boolean)
}
