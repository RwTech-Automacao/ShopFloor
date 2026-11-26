import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

/**
 * Cache das leituras do Compels no banco (`sat_compels_cache`, 0198): a estrutura muda pouco, então a tela da
 * manutenção não chama o Compels a cada abertura. Validade de 7 dias; Compels fora do ar → vale o guardado vencido.
 */
export const VALIDADE_CACHE_MS = 7 * 24 * 60 * 60 * 1000

export interface ArmazemCache {
  ler(chave: string): Promise<{ dados: unknown; lidoEm: string } | null>
  gravar(chave: string, dados: unknown): Promise<void>
}

/**
 * O conteúdo do cache é gravável por quem tem `sat.manutencao`: não é confiável. Com `valido`, o que não tem o
 * formato esperado conta como ausente (relê do Compels; nunca é usado, nem vencido).
 */
export async function lerComCache<T>(
  chave: string,
  buscar: () => Promise<T>,
  armazem: ArmazemCache,
  agora = Date.now(),
  valido: (x: unknown) => x is T = (x): x is T => true,
): Promise<T> {
  let guardado = await armazem.ler(chave)
  if (guardado && !valido(guardado.dados)) guardado = null
  if (guardado && agora - Date.parse(guardado.lidoEm) < VALIDADE_CACHE_MS) return guardado.dados as T
  let novo: T
  try {
    novo = await buscar()
  } catch (e) {
    if (guardado) return guardado.dados as T
    throw e
  }
  try {
    await armazem.gravar(chave, novo)
  } catch (e) {
    console.error('[sat] cache do Compels não gravou:', chave, e instanceof Error ? e.message : e)
  }
  return novo
}

/** Lê pelo RLS (sat.visualizar) e grava pela função `sat_compels_cache_gravar` (sat.manutencao). */
export function armazemDoBanco(): ArmazemCache {
  return {
    async ler(chave) {
      const sb = await createServerSupabase()
      const { data, error } = await sb.from('sat_compels_cache').select('dados, lido_em').eq('chave', chave).maybeSingle()
      if (error) throw new Error(`cache do Compels: ${error.message}`)
      return data ? { dados: (data as { dados: unknown }).dados, lidoEm: String((data as { lido_em: unknown }).lido_em) } : null
    },
    async gravar(chave, dados) {
      const sb = await createServerSupabase()
      const { error } = await sb.rpc('sat_compels_cache_gravar', { p_chave: chave, p_dados: dados })
      if (error) throw new Error(error.message)
    },
  }
}
