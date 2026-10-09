import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { lerResumoFinalizacao, type ResumoFinalizacao } from '../domain/finalizacao'

/**
 * Chama a rotina `sf_sincronizar_finalizacao()` (0145) com o client de SERVICE ROLE — a função só
 * é executável por esse papel. Lança em qualquer falha; quem contém o erro é `rodarFinalizacaoContida`.
 */
export async function sincronizarFinalizacaoDasOps(
  sb: SupabaseClient = createServiceSupabase(),
): Promise<ResumoFinalizacao> {
  const { data, error } = await sb.rpc('sf_sincronizar_finalizacao')
  if (error) throw new Error(`sf_sincronizar_finalizacao: ${error.message}`)
  return lerResumoFinalizacao(data)
}
