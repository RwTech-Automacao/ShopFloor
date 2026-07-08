import { createServerSupabase } from '@/shared/lib/supabase/server'
import { COLUNAS_BUSCA_PROCESSO, sanitizarTermoBusca } from '../domain/busca-processo'

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
 * paginação (`pagina` 0-based, `tamanho` itens por página), filtro opcional
 * por `status` (igualdade) e busca livre opcional (`busca`) em Nº NF, Nº
 * Pedido, fornecedor, código e descrição do material (`ilike`, case-
 * insensitive). O termo de busca é sanitizado (ver `sanitizarTermoBusca`)
 * antes de ser interpolado na string do `.or()`.
 */
export async function listarProcessos({
  busca,
  status,
  pagina,
  tamanho,
}: {
  busca?: string
  status?: string
  pagina: number
  tamanho: number
}): Promise<ResultadoProcessos> {
  const supabase = await createServerSupabase()

  const inicio = pagina * tamanho
  const fim = inicio + tamanho - 1

  let query = supabase
    .from('processos_recebimento')
    .select('id, numero, numero_nf, fornecedor, codigo_material, descricao_material, status', {
      count: 'exact',
    })

  if (status) query = query.eq('status', status)

  const termo = busca ? sanitizarTermoBusca(busca) : ''
  if (termo) {
    query = query.or(COLUNAS_BUSCA_PROCESSO.map((coluna) => `${coluna}.ilike.%${termo}%`).join(','))
  }

  const { data, error, count } = await query.order('numero', { ascending: false }).range(inicio, fim)

  if (error) throw error

  return { linhas: (data ?? []) as ProcessoResumoRow[], total: count ?? 0 }
}
