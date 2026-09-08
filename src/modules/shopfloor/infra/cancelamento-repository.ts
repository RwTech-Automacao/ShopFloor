import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export async function lerRegistroParaCancelar(
  id: string,
): Promise<{ pmo: string; op: string; numeroSerieNorm: string; posto: string } | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('pmo,op,numero_serie_norm,posto')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as { pmo: string; op: string; numero_serie_norm: string; posto: string }
  return { pmo: r.pmo, op: r.op, numeroSerieNorm: r.numero_serie_norm, posto: r.posto }
}

/** É o bipe mais recente (maior data_hora, depois id) do SN nesta OP? */
export async function ehUltimoBipe(
  pmo: string, op: string, numeroSerieNorm: string, id: string,
): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('id')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', numeroSerieNorm)
    .order('data_hora', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error) throw error
  const ultimo = (data ?? [])[0] as { id: string } | undefined
  return ultimo?.id === id
}

export async function chamarSfCancelar(
  id: string, motivo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('sf_cancelar_lancamento', { p_id: id, p_motivo: motivo })
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

/** Uma linha do log de cancelamentos (auditoria), já achatada pra exibição. */
export interface CancelamentoRow {
  id: string
  canceladoEm: string
  motivo: string
  pmo: string
  op: string
  posto: string
  sn: string
  statusOriginal: string
  colaboradorOriginal: string
  canceladoPor: string // nome de quem cancelou (ou '—' se não resolver)
}

/** Log de cancelamentos (mais recente primeiro). Resolve o nome de quem cancelou (best-effort). */
export async function listarCancelamentos(limite = 200): Promise<CancelamentoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros_cancelados')
    .select('id, cancelado_em, motivo, pmo, op, posto, cancelado_por, dados')
    .order('cancelado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  const linhas = (data ?? []) as {
    id: string; cancelado_em: string; motivo: string; pmo: string; op: string; posto: string
    cancelado_por: string | null; dados: Record<string, unknown> | null
  }[]

  // Resolve uuid -> nome de quem cancelou (best-effort; RLS pode limitar → cai em '—').
  const ids = [...new Set(linhas.map((l) => l.cancelado_por).filter((x): x is string => !!x))]
  const nomes = new Map<string, string>()
  if (ids.length > 0) {
    const { data: us } = await supabase.from('usuarios').select('id, nome').in('id', ids)
    for (const u of (us ?? []) as { id: string; nome: string }[]) nomes.set(u.id, u.nome)
  }

  return linhas.map((l) => ({
    id: l.id,
    canceladoEm: l.cancelado_em,
    motivo: l.motivo,
    pmo: l.pmo,
    op: l.op,
    posto: l.posto,
    sn: String(l.dados?.numero_serie ?? ''),
    statusOriginal: String(l.dados?.status ?? ''),
    colaboradorOriginal: String(l.dados?.colaborador ?? ''),
    canceladoPor: (l.cancelado_por && nomes.get(l.cancelado_por)) || '—',
  }))
}
