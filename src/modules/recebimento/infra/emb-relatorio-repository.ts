import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { lerRelatorioEmb, type RelatorioEmb } from '../domain/emb-relatorio'

/**
 * O relatório de uma EMB, com a SESSÃO do usuário (a `rec_emb_relatorio`, 0178, confere
 * tem_permissao('recebimento','visualizar') no banco). Null = nenhum processo com essa EMB.
 */
export async function buscarRelatorioEmb(emb: string): Promise<RelatorioEmb | null> {
  if (emb.trim() === '') return null
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('rec_emb_relatorio', { p_emb: emb })
  if (error) throw new Error(`rec_emb_relatorio: ${error.message}`)
  const r = lerRelatorioEmb(data)
  if (r.ok) return r.valor
  if (r.motivo === 'emb_inexistente') return null
  throw new Error('rec_emb_relatorio: resposta ilegível')
}
