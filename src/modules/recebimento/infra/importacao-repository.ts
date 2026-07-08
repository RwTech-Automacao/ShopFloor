import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface ImportacaoRow {
  id: string
  arquivo_nome: string
  formato: 'xlsx' | 'csv'
  total_processos_criados: number
  created_at: string
  usuario_id: string | null
  usuarios: { nome: string } | null
}

interface RpcImportarProcessosResultado {
  importacao_id: string
  total: number
}

/**
 * Chama a RPC `importar_processos` (SECURITY INVOKER) com a sessão do
 * usuário — a permissão `importar` é validada pela RLS/RPC no banco.
 * Retorna o id da importação criada e o total de processos gerados, ou
 * lança em caso de erro (nenhum dado é gravado).
 */
export async function chamarImportarProcessos(payload: {
  arquivoNome: string
  formato: 'xlsx' | 'csv'
  mapeamento: Record<string, string>
  linhas: Record<string, string | number | null>[]
}): Promise<{ importacaoId: string; total: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('importar_processos', {
    p_arquivo_nome: payload.arquivoNome,
    p_formato: payload.formato,
    p_mapeamento: payload.mapeamento,
    p_linhas: payload.linhas,
  })

  if (error) throw error

  const resultado = data as unknown as RpcImportarProcessosResultado
  return { importacaoId: resultado.importacao_id, total: resultado.total }
}

/**
 * Lista as importações já realizadas (mais recentes primeiro), com o nome
 * do usuário responsável.
 */
export async function listarImportacoes(): Promise<ImportacaoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('importacoes')
    .select('id, arquivo_nome, formato, total_processos_criados, created_at, usuario_id, usuarios(nome)')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []) as unknown as ImportacaoRow[]
}
