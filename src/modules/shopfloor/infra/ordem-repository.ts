import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface PostoRow {
  chave: string
  ordem: number
  perfil: string
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
  embalagem_individual: boolean
  created_at: string
  sf_ordem_postos: { posto: string; ordem: number }[]
  sf_ordem_componentes: { posto: string; pmo_componente: string }[]
  sf_ordem_burnin: { posto: string; tempo_min: number }[]
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
  embalagem_individual: boolean
}

export async function listarPostos(): Promise<PostoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_postos').select('chave,ordem,perfil').order('ordem')
  if (error) throw error
  return data as PostoRow[]
}

export async function listarOrdens(): Promise<OrdemRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('id,pmo,op,cliente,qtd,descricao,acp,status,sn_ini,sn_fim,embalagem_individual,created_at,sf_ordem_postos(posto,ordem),sf_ordem_componentes(posto,pmo_componente),sf_ordem_burnin(posto,tempo_min)')
    .order('pmo')
    .order('op')
  if (error) throw error
  return data as unknown as OrdemRow[]
}

/** Insere a OP, a aplicabilidade e a receita; devolve o id. */
export async function criarOrdem(dados: DadosOrdem, postos: string[], receita: { posto: string; pmo: string }[], burnin: { posto: string; tempo_min: number }[]): Promise<string> {
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
  if (receita.length > 0) {
    const { error: e3 } = await supabase
      .from('sf_ordem_componentes')
      .insert(receita.map((r) => ({ ordem_id: id, posto: r.posto, pmo_componente: r.pmo })))
    if (e3) throw e3
  }
  if (burnin.length > 0) {
    const { error: e4 } = await supabase
      .from('sf_ordem_burnin')
      .insert(burnin.map((b) => ({ ordem_id: id, posto: b.posto, tempo_min: b.tempo_min })))
    if (e4) throw e4
  }
  return id
}

/** Atualiza a OP e RESSINCRONIZA a aplicabilidade e a receita (apaga e reinsere). */
export async function atualizarOrdem(id: string, dados: DadosOrdem, postos: string[], receita: { posto: string; pmo: string }[], burnin: { posto: string; tempo_min: number }[]): Promise<void> {
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
  const { error: eDelC } = await supabase.from('sf_ordem_componentes').delete().eq('ordem_id', id)
  if (eDelC) throw eDelC
  if (receita.length > 0) {
    const { error: eInsC } = await supabase
      .from('sf_ordem_componentes')
      .insert(receita.map((r) => ({ ordem_id: id, posto: r.posto, pmo_componente: r.pmo })))
    if (eInsC) throw eInsC
  }
  const { error: eDelB } = await supabase.from('sf_ordem_burnin').delete().eq('ordem_id', id)
  if (eDelB) throw eDelB
  if (burnin.length > 0) {
    const { error: eInsB } = await supabase
      .from('sf_ordem_burnin')
      .insert(burnin.map((b) => ({ ordem_id: id, posto: b.posto, tempo_min: b.tempo_min })))
    if (eInsB) throw eInsB
  }
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

/** OP já usa esse número (em qualquer PMO)? Regra de OP única global. `excetoId` ignora a própria OP na edição. */
export async function buscarOpEmUso(op: string, excetoId?: string): Promise<{ id: string; pmo: string; op: string } | null> {
  const supabase = await createServerSupabase()
  let q = supabase.from('sf_ordens').select('id,pmo,op').eq('op', op).limit(1)
  if (excetoId) q = q.neq('id', excetoId)
  const { data, error } = await q
  if (error) throw error
  const row = data?.[0]
  return row ? (row as { id: string; pmo: string; op: string }) : null
}

export async function buscarOrdemBase(id: string): Promise<{ pmo: string; op: string } | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').select('pmo,op').eq('id', id).single()
  if (error) return null
  return data as { pmo: string; op: string }
}
