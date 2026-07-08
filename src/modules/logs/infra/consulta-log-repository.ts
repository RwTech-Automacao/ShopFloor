import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface LogRow {
  id: string
  entidade: string
  entidade_id: string | null
  acao: string
  descricao: string
  dados: unknown
  usuario_nome: string
  created_at: string
}

export interface FiltrosLog {
  entidade?: string
  acao?: string
  usuarioId?: string
  de?: string
  ate?: string
  pagina: number
  tamanho: number
}

export interface ResultadoLogs {
  linhas: LogRow[]
  total: number
}

export async function consultarLogs(filtros: FiltrosLog): Promise<ResultadoLogs> {
  const supabase = await createServerSupabase()

  let query = supabase
    .from('logs')
    .select('id,entidade,entidade_id,acao,descricao,dados,usuario_nome,created_at', {
      count: 'exact',
    })

  if (filtros.entidade) query = query.eq('entidade', filtros.entidade)
  if (filtros.acao) query = query.eq('acao', filtros.acao)
  if (filtros.usuarioId) query = query.eq('usuario_id', filtros.usuarioId)
  if (filtros.de) query = query.gte('created_at', filtros.de)
  if (filtros.ate) query = query.lte('created_at', filtros.ate)

  const inicio = filtros.pagina * filtros.tamanho
  const fim = inicio + filtros.tamanho - 1

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(inicio, fim)

  if (error) throw error

  return { linhas: (data ?? []) as LogRow[], total: count ?? 0 }
}
