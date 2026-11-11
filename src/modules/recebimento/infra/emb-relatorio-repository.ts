import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { lerRelatorioEmb, type DivergenciaDaEmb, type RelatorioEmb } from '../domain/emb-relatorio'

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
  if (r.ok) return { ...r.valor, divergencias: await comPedidoPorItem(sb, r.valor.divergencias) }
  if (r.motivo === 'emb_inexistente') return null
  throw new Error('rec_emb_relatorio: resposta ilegível')
}

/**
 * O Nº da PO de CADA divergência (a planilha tem uma coluna com ele). A `rec_emb_relatorio` só agrega as POs da
 * EMB; aqui se lê o `numero_pedido` dos processos pelo id, com a mesma sessão. Falhou a leitura: fica sem PO.
 */
async function comPedidoPorItem(
  sb: Awaited<ReturnType<typeof createServerSupabase>>,
  divergencias: DivergenciaDaEmb[],
): Promise<DivergenciaDaEmb[]> {
  const ids = [...new Set(divergencias.map((d) => d.id).filter((id): id is string => id !== null))]
  if (ids.length === 0) return divergencias
  const { data, error } = await sb.from('processos_recebimento').select('id, numero_pedido').in('id', ids)
  if (error || !data) return divergencias
  const pedidoDe = new Map(data.map((p) => [p.id as string, String(p.numero_pedido ?? '').trim()]))
  return divergencias.map((d) => (d.id && pedidoDe.has(d.id) ? { ...d, pedido: pedidoDe.get(d.id)! } : d))
}
