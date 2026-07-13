import { createServerSupabase } from '@/shared/lib/supabase/server'
import { COLUNAS_BUSCA_PROCESSO, sanitizarTermoBusca } from '../domain/busca-processo'
import { agruparPorMes, inicioProximoMes, type GrupoMes } from '../domain/agrupamento-mes'
import { condicaoBuscaProcesso } from '../domain/busca-processo'

export interface ProcessoResumoRow {
  id: string
  numero: number
  numero_nf: string | null
  numero_emb: string | null
  di_inpi: string | null
  acp_cliente: string | null
  numero_pedido: string | null
  tipo: string | null
  fornecedor: string | null
  codigo_material: string | null
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
    .select(
      'id, numero, numero_nf, numero_emb, di_inpi, acp_cliente, numero_pedido, tipo, fornecedor, codigo_material, status',
      { count: 'exact' },
    )

  if (status) query = query.eq('status', status)

  const termo = busca ? sanitizarTermoBusca(busca) : ''
  if (termo) {
    query = query.or(COLUNAS_BUSCA_PROCESSO.map((coluna) => `${coluna}.ilike.%${termo}%`).join(','))
  }

  const { data, error, count } = await query.order('numero', { ascending: false }).range(inicio, fim)

  if (error) throw error

  return { linhas: (data ?? []) as ProcessoResumoRow[], total: count ?? 0 }
}

export interface FiltrosProcessos {
  busca?: string
  status?: string
}

/**
 * Grupos por mês da data de chegada (com contagem), respeitando busca/status.
 * Busca só a coluna `data_chegada` (query leve) e agrupa em TS — sem GROUP BY
 * no banco, sem migração.
 */
export async function listarMesesProcessos(filtros: FiltrosProcessos): Promise<GrupoMes[]> {
  const supabase = await createServerSupabase()
  let query = supabase.from('processos_recebimento').select('data_chegada')
  if (filtros.status) query = query.eq('status', filtros.status)
  const or = condicaoBuscaProcesso(filtros.busca)
  if (or) query = query.or(or)
  const { data, error } = await query
  if (error) throw error
  const datas = (data ?? []).map((r) => (r as { data_chegada: string | null }).data_chegada)
  return agruparPorMes(datas)
}

/**
 * Linhas de um grupo: um mês (`chave` 'YYYY-MM', recorte por range de data) ou
 * 'sem_data' (data_chegada nula). Mesmas colunas e ordem (número desc) da lista.
 */
export async function listarProcessosDoMes(
  filtros: FiltrosProcessos,
  chave: string,
): Promise<ProcessoResumoRow[]> {
  const supabase = await createServerSupabase()
  let query = supabase
    .from('processos_recebimento')
    .select(
      'id, numero, numero_nf, numero_emb, di_inpi, acp_cliente, numero_pedido, tipo, fornecedor, codigo_material, status',
    )
  if (filtros.status) query = query.eq('status', filtros.status)
  const or = condicaoBuscaProcesso(filtros.busca)
  if (or) query = query.or(or)
  if (chave === 'sem_data') {
    query = query.is('data_chegada', null)
  } else {
    query = query.gte('data_chegada', `${chave}-01`).lt('data_chegada', inicioProximoMes(chave))
  }
  const { data, error } = await query.order('numero', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProcessoResumoRow[]
}
