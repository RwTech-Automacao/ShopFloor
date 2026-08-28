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
