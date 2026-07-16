import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface PadraoImportacao {
  id: string
  nome: string
  mapeamento: Record<string, string>
  updatedAt: string
}

interface PadraoRow {
  id: string
  nome: string
  mapeamento: Record<string, string> | null
  updated_at: string
}

const COLUNAS = 'id, nome, mapeamento, updated_at'

function mapRow(row: PadraoRow): PadraoImportacao {
  return {
    id: row.id,
    nome: row.nome,
    mapeamento: row.mapeamento ?? {},
    updatedAt: row.updated_at,
  }
}

/** Lista os padrões salvos, ordenados por nome. RLS libera para quem importa. */
export async function listarPadroesImportacao(): Promise<PadraoImportacao[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('padroes_importacao')
    .select(COLUNAS)
    .order('nome', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => mapRow(row as unknown as PadraoRow))
}

/** Cria um padrão. Lança em violação de nome único (código Postgres 23505). */
export async function inserirPadraoImportacao(
  nome: string,
  mapeamento: Record<string, string>,
): Promise<PadraoImportacao> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('padroes_importacao')
    .insert({ nome, mapeamento })
    .select(COLUNAS)
    .single()
  if (error) throw error
  return mapRow(data as unknown as PadraoRow)
}

/** Substitui o mapeamento de um padrão e atualiza updated_at. */
export async function atualizarPadraoImportacao(
  id: string,
  mapeamento: Record<string, string>,
): Promise<PadraoImportacao> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('padroes_importacao')
    .update({ mapeamento, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLUNAS)
    .single()
  if (error) throw error
  return mapRow(data as unknown as PadraoRow)
}

/** Exclui um padrão pelo id. */
export async function excluirPadraoImportacao(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('padroes_importacao').delete().eq('id', id)
  if (error) throw error
}
