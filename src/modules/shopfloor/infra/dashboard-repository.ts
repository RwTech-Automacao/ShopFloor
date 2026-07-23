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
