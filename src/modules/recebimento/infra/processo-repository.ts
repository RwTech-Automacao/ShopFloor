import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface ProcessoResumoRow {
  id: string
  numero: number
  numero_nf: string | null
  fornecedor: string | null
  codigo_material: string | null
  descricao_material: string | null
  status: string
}

export interface ResultadoProcessos {
  linhas: ProcessoResumoRow[]
  total: number
}

/**
 * Lista os processos de recebimento em ordem decrescente de número, com
 * paginação (`pagina` 0-based, `tamanho` itens por página).
 */
export async function listarProcessos({
  pagina,
  tamanho,
}: {
  pagina: number
  tamanho: number
}): Promise<ResultadoProcessos> {
  const supabase = await createServerSupabase()

  const inicio = pagina * tamanho
  const fim = inicio + tamanho - 1

  const { data, error, count } = await supabase
    .from('processos_recebimento')
    .select('id, numero, numero_nf, fornecedor, codigo_material, descricao_material, status', {
      count: 'exact',
    })
    .order('numero', { ascending: false })
    .range(inicio, fim)

  if (error) throw error

  return { linhas: (data ?? []) as ProcessoResumoRow[], total: count ?? 0 }
}
