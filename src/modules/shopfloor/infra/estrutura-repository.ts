import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { TrechoDaOp } from '../domain/trechos-op'

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

/** Os trechos da OP com os postos de cada um (seletor do Fluxo). OP sem trechos ou inexistente: vazio. */
export async function listarTrechosDaOp(pmo: string, op: string): Promise<TrechoDaOp[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sf_ordens')
    .select('sf_ordem_trechos(seq,codigo,tipo,compels_op),sf_ordem_postos(posto,ordem,trecho_seq)')
    .eq('pmo', pmo).eq('op', op).maybeSingle()
  if (error) throw new Error(`trechos da OP: ${error.message}`)
  const d = data as {
    sf_ordem_trechos?: { seq: number; codigo: string; tipo: 'prt' | 'pmo'; compels_op: string | null }[]
    sf_ordem_postos?: { posto: string; ordem: number; trecho_seq: number | null }[]
  } | null
  const postos = [...(d?.sf_ordem_postos ?? [])].sort((a, b) => a.ordem - b.ordem)
  return [...(d?.sf_ordem_trechos ?? [])].sort((a, b) => a.seq - b.seq).map((t) => ({
    seq: t.seq, codigo: t.codigo, tipo: t.tipo, compelsOp: t.compels_op,
    postos: postos.filter((p) => p.trecho_seq === t.seq).map((p) => p.posto),
  }))
}
