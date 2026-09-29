import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type { LinhaOrdem, LinhaRecebimento } from '../domain/foto'
import type { LeitorFoto } from '../application/portas'

/**
 * Cada função da 0134 devolve UM jsonb com a lista inteira (não `setof`/`table`): uma chamada só,
 * sem `.range()`/paginação por offset. Paginar leria a tabela em pedaços, em instantes diferentes
 * — linhas mudando entre uma página e outra fariam a "foto" deixar de ser uma foto.
 */
async function lerJsonb<T>(sb: SupabaseClient, funcao: string): Promise<T[]> {
  const { data, error } = await sb.rpc(funcao)
  if (error) throw new Error(`${funcao}: ${error.message}`)
  if (!Array.isArray(data)) throw new Error(`${funcao}: resposta não é um array jsonb (${data === null ? 'null' : typeof data})`)
  return data as T[]
}

/**
 * Lê as duas funções da 0134 com o client de SERVICE ROLE (cron, sem sessão de usuário — as
 * funções só têm `grant execute` pra `service_role`, então nenhum outro client conseguiria).
 */
export function criarLeitorServico(sb: SupabaseClient = createServiceSupabase()): LeitorFoto {
  return {
    lerRecebimentos: () => lerJsonb<LinhaRecebimento>(sb, 'central_recebimentos_para_sincronizar'),
    lerOrdens: () => lerJsonb<LinhaOrdem>(sb, 'central_ordens_para_sincronizar'),
  }
}
