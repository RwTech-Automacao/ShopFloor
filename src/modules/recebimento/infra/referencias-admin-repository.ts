import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface CriticidadeRow {
  id: string
  fornecedor: string
}

export interface NqaRow {
  id: string
  quantidadeMin: number
  quantidadeMax: number | null
  tamanhoAmostra: number | null
  ordem: number
}

interface CriticidadeRowDb {
  id: string
  fornecedor: string
}

interface NqaRowDb {
  id: string
  quantidade_min: number
  quantidade_max: number | null
  tamanho_amostra: number | null
  ordem: number
}

/**
 * Lista completa dos fornecedores críticos, com id — usada pela tela de
 * administração (`configuracoes/criticidade`). Para o cálculo do campo
 * `critico`, ver `carregarCriticidade` em `referencias-repository`.
 */
export async function listarCriticidade(): Promise<CriticidadeRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('criticidade_fornecedor')
    .select('id, fornecedor')
    .order('fornecedor', { ascending: true })
  if (error) throw error
  return (data ?? []) as CriticidadeRowDb[]
}

export async function buscarCriticidadePorId(id: string): Promise<CriticidadeRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('criticidade_fornecedor')
    .select('id, fornecedor')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as CriticidadeRowDb | null) ?? null
}

export async function criarCriticidade(fornecedor: string): Promise<{ id: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('criticidade_fornecedor')
    .insert({ fornecedor })
    .select('id')
    .single()
  if (error) throw error
  return { id: (data as { id: string }).id }
}

export async function excluirCriticidade(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('criticidade_fornecedor').delete().eq('id', id)
  if (error) throw error
}

/**
 * Lista completa das faixas da tabela NQA, com id — usada pela tela de
 * administração (`configuracoes/nqa`). Para o cálculo do campo `amostral`,
 * ver `carregarTabelaNqa` em `referencias-repository`.
 */
export async function listarNqa(): Promise<NqaRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('tabela_nqa')
    .select('id, quantidade_min, quantidade_max, tamanho_amostra, ordem')
    .order('ordem', { ascending: true })
  if (error) throw error
  return ((data ?? []) as NqaRowDb[]).map((row) => ({
    id: row.id,
    quantidadeMin: row.quantidade_min,
    quantidadeMax: row.quantidade_max,
    tamanhoAmostra: row.tamanho_amostra,
    ordem: row.ordem,
  }))
}

export async function buscarNqaPorId(id: string): Promise<NqaRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('tabela_nqa')
    .select('id, quantidade_min, quantidade_max, tamanho_amostra, ordem')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as NqaRowDb
  return {
    id: row.id,
    quantidadeMin: row.quantidade_min,
    quantidadeMax: row.quantidade_max,
    tamanhoAmostra: row.tamanho_amostra,
    ordem: row.ordem,
  }
}

export async function atualizarTamanhoNqa(id: string, tamanho: number | null): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('tabela_nqa')
    .update({ tamanho_amostra: tamanho })
    .eq('id', id)
  if (error) throw error
}
