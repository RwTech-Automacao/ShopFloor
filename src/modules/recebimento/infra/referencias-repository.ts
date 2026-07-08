import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { FaixaNqa } from '../domain/calculos'

interface CriticidadeFornecedorRow {
  fornecedor: string
  critico: string
}

interface TabelaNqaRow {
  quantidade_min: number
  quantidade_max: number | null
  tamanho_amostra: number | null
}

/**
 * Carrega a tabela de criticidade por fornecedor (`criticidade_fornecedor`),
 * usada pelo cálculo do campo `critico` (`lookup_fornecedor_critico`).
 */
export async function carregarCriticidade(): Promise<CriticidadeFornecedorRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('criticidade_fornecedor').select('fornecedor, critico')
  if (error) throw error
  return (data ?? []) as CriticidadeFornecedorRow[]
}

/**
 * Carrega a tabela NQA (faixas de quantidade recebida -> tamanho de
 * amostra), usada pelo cálculo do campo `amostral` (`tabela_nqa`). Ordenada
 * por `ordem` para que as faixas fiquem na sequência crescente esperada por
 * `buscarNqa`.
 */
export async function carregarTabelaNqa(): Promise<FaixaNqa[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('tabela_nqa')
    .select('quantidade_min, quantidade_max, tamanho_amostra')
    .order('ordem', { ascending: true })
  if (error) throw error

  return ((data ?? []) as TabelaNqaRow[]).map((row) => ({
    quantidadeMin: row.quantidade_min,
    quantidadeMax: row.quantidade_max,
    tamanhoAmostra: row.tamanho_amostra,
  }))
}
