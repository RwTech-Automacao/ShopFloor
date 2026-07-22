import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface PostoRow {
  chave: string
  ordem: number
}

export interface OrdemRow {
  id: string
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  sn_ini: string
  sn_fim: string
  sf_ordem_postos: { posto: string; ordem: number }[]
}

export interface DadosOrdem {
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  sn_ini: string
  sn_fim: string
}

export async function listarPostos(): Promise<PostoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_postos').select('chave,ordem').order('ordem')
  if (error) throw error
  return data as PostoRow[]
}

export async function listarOrdens(): Promise<OrdemRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('id,pmo,op,cliente,qtd,descricao,acp,status,sn_ini,sn_fim,sf_ordem_postos(posto,ordem)')
    .order('pmo')
    .order('op')
  if (error) throw error
  return data as unknown as OrdemRow[]
}

/** Insere a OP e a aplicabilidade; devolve o id. */
export async function criarOrdem(dados: DadosOrdem, postos: string[]): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').insert(dados).select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id
  if (postos.length > 0) {
    const { error: e2 } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto, i) => ({ ordem_id: id, posto, ordem: i })))
    if (e2) throw e2
  }
  return id
}

/** Atualiza a OP e RESSINCRONIZA a aplicabilidade (apaga e reinsere). */
export async function atualizarOrdem(id: string, dados: DadosOrdem, postos: string[]): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_ordens')
    .update({ ...dados, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  const { error: eDel } = await supabase.from('sf_ordem_postos').delete().eq('ordem_id', id)
  if (eDel) throw eDel
  if (postos.length > 0) {
    const { error: eIns } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto, i) => ({ ordem_id: id, posto, ordem: i })))
    if (eIns) throw eIns
  }
}

export async function listarFluxos(): Promise<{ pmo: string; op: string; postos: string[] }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo,op,sf_ordem_postos(posto,ordem)')
    .order('pmo')
    .order('op')
  if (error) throw error
  const linhas = data as unknown as {
    pmo: string
    op: string
    sf_ordem_postos: { posto: string; ordem: number }[]
  }[]
  return linhas.map((l) => ({
    pmo: l.pmo,
    op: l.op,
    postos: [...l.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
  }))
}

export async function excluirOrdem(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_ordens').delete().eq('id', id)
  if (error) throw error
}

/** Quantos registros de lançamento existem para a OP (guarda de exclusão). */
export async function contarRegistros(pmo: string, op: string): Promise<number> {
  const supabase = await createServerSupabase()
  const { count, error } = await supabase
    .from('sf_registros')
    .select('*', { count: 'exact', head: true })
    .eq('pmo', pmo)
    .eq('op', op)
  if (error) throw error
  return count ?? 0
}

export async function buscarOrdemBase(id: string): Promise<{ pmo: string; op: string } | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').select('pmo,op').eq('id', id).single()
  if (error) return null
  return data as { pmo: string; op: string }
}
