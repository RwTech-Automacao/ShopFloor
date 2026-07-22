import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface OrdemLancamento {
  cliente: string
  descricao: string
  sn_ini: string
  sn_fim: string
  postos: string[]
}

export interface SfLancarArgs {
  p_pmo: string
  p_op: string
  p_cliente: string
  p_posto: string
  p_colaborador: string
  p_numero_serie: string
  p_numero_serie_norm: string
  p_status: string
  p_posto_tem_status: boolean
  p_numero_caixa: string
  p_qtd_por_caixa: number | null
  p_nqa_visual: string
  p_nqa_funcional: string
  p_prev_posto: string
  p_prev_precisa_aprovado: boolean
  p_linhas: { codigo_defeito: string; posicao: string; tipo_defeito: string }[]
}

/** Clientes distintos das OPs ativas (status ≠ FINALIZADA). */
export async function listarClientes(): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente')
    .neq('status', 'FINALIZADA')
    .order('cliente')
  if (error) throw error
  return [...new Set((data as { cliente: string }[]).map((r) => r.cliente).filter(Boolean))]
}

export async function listarPmos(cliente: string): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo')
    .eq('cliente', cliente)
    .neq('status', 'FINALIZADA')
    .order('pmo')
  if (error) throw error
  return [...new Set((data as { pmo: string }[]).map((r) => r.pmo).filter(Boolean))]
}

export async function listarOps(cliente: string, pmo: string): Promise<{ op: string }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('op')
    .eq('cliente', cliente)
    .eq('pmo', pmo)
    .neq('status', 'FINALIZADA')
    .order('op')
  if (error) throw error
  return data as { op: string }[]
}

export async function carregarOrdem(pmo: string, op: string): Promise<OrdemLancamento | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente,descricao,sn_ini,sn_fim,sf_ordem_postos(posto,ordem)')
    .eq('pmo', pmo)
    .eq('op', op)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as {
    cliente: string
    descricao: string
    sn_ini: string
    sn_fim: string
    sf_ordem_postos: { posto: string; ordem: number }[]
  }
  return {
    cliente: row.cliente,
    descricao: row.descricao,
    sn_ini: row.sn_ini,
    sn_fim: row.sn_fim,
    // postos NA ORDEM da OP (a sequência importa p/ a trava de sequência).
    postos: [...row.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
  }
}

export async function listarDefeitos(): Promise<{ codigo: string; tipo: number }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_defeitos').select('codigo,tipo').order('codigo')
  if (error) throw error
  return data as { codigo: string; tipo: number }[]
}

/** Chama a função atômica sf_lancar. Erros de infra viram { ok:false, erro:'ERRO_INTERNO' }. */
export async function chamarSfLancar(
  args: SfLancarArgs,
): Promise<{ ok: boolean; erro?: string; caixa_count?: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_lancar', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; caixa_count?: number }
}
