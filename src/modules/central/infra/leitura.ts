import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type { LinhaOrdem, LinhaRecebimento } from '../domain/foto'
import type { LeitorFoto } from '../application/portas'

/** O PostgREST limita a 1000 linhas por resposta (max_rows): pagina até vir menos que isso. */
const TAMANHO_PAGINA = 1000

async function paginar<T>(sb: SupabaseClient, funcao: string): Promise<T[]> {
  const linhas: T[] = []
  for (let i = 0; ; i++) {
    const inicio = i * TAMANHO_PAGINA
    const { data, error } = await sb.rpc(funcao).range(inicio, inicio + TAMANHO_PAGINA - 1)
    if (error) throw new Error(`${funcao}: ${error.message}`)
    const lote = (data ?? []) as T[]
    linhas.push(...lote)
    if (lote.length < TAMANHO_PAGINA) break
  }
  return linhas
}

/**
 * Lê as duas funções da 0134 com o client de SERVICE ROLE (cron, sem sessão de usuário — as
 * funções só têm `grant execute` pra `service_role`, então nenhum outro client conseguiria).
 */
export function criarLeitorServico(sb: SupabaseClient = createServiceSupabase()): LeitorFoto {
  return {
    lerRecebimentos: () => paginar<LinhaRecebimento>(sb, 'central_recebimentos_para_sincronizar'),
    lerOrdens: () => paginar<LinhaOrdem>(sb, 'central_ordens_para_sincronizar'),
  }
}
