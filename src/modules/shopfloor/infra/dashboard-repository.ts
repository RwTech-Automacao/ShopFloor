import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { RegistroContagem } from '../domain/dashboard'

const PAGINA = 1000

/** Registros (posto,status) da OP, com período opcional (datas YYYY-MM-DD, fuso -03:00). Paginado. */
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
      .select('posto,status')
      .eq('pmo', pmo)
      .eq('op', op)
      .order('id', { ascending: true })
      .range(ini, ini + PAGINA - 1)
    if (de) q = q.gte('data_hora', `${de}T00:00:00-03:00`)
    if (ate) q = q.lte('data_hora', `${ate}T23:59:59-03:00`)
    const { data, error } = await q
    if (error) throw error
    const rows = data as { posto: string; status: string }[]
    out.push(...rows.map((r) => ({ posto: r.posto, status: r.status })))
    if (rows.length < PAGINA) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Dashboard geral (várias OPs) — tudo agregado no banco (migração 0101)
// ---------------------------------------------------------------------------

import type { FiltroDashboard, LinhaGrade, TotaisDashboard, DefeitoDashboard } from '../domain/dashboard'

/**
 * Converte o filtro da tela nos parâmetros da RPC.
 *
 * As datas vêm dos inputs como YYYY-MM-DD e viram o DIA INTEIRO no fuso de produção — quem escolhe
 * "até 10/09" espera o dia 10 inteiro, não até a meia-noite dele.
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
    finalizada: boolean; posto: string; aprovados: number; reprovados: number
    pecas: number; ops_total: number
  }
  const rows = (data ?? []) as Row[]
  return {
    linhas: rows.map((r) => ({
      pmo: r.pmo, op: r.op, cliente: r.cliente, descricao: r.descricao ?? '',
      qtdOp: r.qtd_op, finalizada: r.finalizada === true, posto: r.posto ?? '',
      aprovados: r.aprovados ?? 0, reprovados: r.reprovados ?? 0, pecas: r.pecas ?? 0,
    })),
    // `ops_total` viaja repetido em toda linha (result set único do PostgREST); 0 quando não há linha.
    opsTotal: rows[0]?.ops_total ?? 0,
  }
}

/** Top N defeitos do recorte + quanto ficou de fora ("Outros"). */
export async function carregarDefeitosDashboard(
  f: FiltroDashboard, limite: number,
): Promise<{ topo: DefeitoDashboard[]; outros: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_dashboard_defeitos', { ...paramsDoFiltro(f), p_limite: limite })
  if (error) throw error
  const rows = (data ?? []) as { codigo: string; total: number; resto: number }[]
  return {
    topo: rows.map((r) => ({ codigo: r.codigo, total: r.total })),
    outros: rows[0]?.resto ?? 0,
  }
}
