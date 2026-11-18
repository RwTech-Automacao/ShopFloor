import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

/** Trechos da OP (0184): leitura para a edição de OP e para o Fluxo. */

/** A OP tem trechos do Compels? Erro de leitura sobe: quem chama trava. */
export async function ordemTemTrechos(ordemId: string): Promise<boolean> {
  const sb = await createServerSupabase()
  const { count, error } = await sb.from('sf_ordem_trechos').select('seq', { count: 'exact', head: true }).eq('ordem_id', ordemId)
  if (error) throw new Error(`sf_ordem_trechos: ${error.message}`)
  return (count ?? 0) > 0
}

export interface ResumoTrecho { posto: string; codigo: string; compelsOp: string | null; apontadas: number; naFila: number; motivo: string | null }

/**
 * Por trecho da OP: quantas peças já foram apontadas no Compels (entradas − estornos enviados), quantas esperam e o
 * motivo da mais antiga. Uma chamada só (sf_resumo_trechos_op, 0184): o card do Fluxo não pagina a fila no servidor.
 */
export async function resumoTrechosDaOp(pmo: string, op: string): Promise<ResumoTrecho[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sf_resumo_trechos_op', { p_pmo: pmo, p_op: op })
  if (error) throw new Error(`sf_resumo_trechos_op: ${error.message}`)
  type Linha = { posto: string; codigo: string; compels_op: string | null; apontadas: number | null; na_fila: number | null; motivo: string | null }
  return ((data ?? []) as Linha[]).map((l) => ({
    posto: l.posto,
    codigo: l.codigo,
    compelsOp: l.compels_op,
    apontadas: Number(l.apontadas ?? 0),
    naFila: Number(l.na_fila ?? 0),
    motivo: l.motivo,
  }))
}
