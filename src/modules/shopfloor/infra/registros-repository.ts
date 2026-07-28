import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { FiltrosRegistros } from '@/modules/shopfloor/domain/registros-filtros'

export interface RegistroRow {
  id: string
  data_hora: string
  colaborador: string
  posto: string
  pmo: string
  op: string
  cliente: string
  numero_caixa: string
  qtd_por_caixa: number | null
  status: string
  numero_serie: string
  codigo_defeito: string
  posicao: string
  tipo_defeito: string
  nqa_visual: string
  nqa_funcional: string
  id_integracao: string
  reparo_conserto: string
  reparo_posicao: string
  posto_origem: string
  data_hora_origem: string | null
}

export interface ResultadoRegistros {
  linhas: RegistroRow[]
  total: number
}

const COLUNAS =
  'id,data_hora,colaborador,posto,pmo,op,cliente,numero_caixa,qtd_por_caixa,status,numero_serie,codigo_defeito,posicao,tipo_defeito,nqa_visual,nqa_funcional,id_integracao,reparo_conserto,reparo_posicao,posto_origem,data_hora_origem'

export async function consultarRegistros(
  filtros: FiltrosRegistros,
  pagina: number,
  tamanho: number,
): Promise<ResultadoRegistros> {
  const supabase = await createServerSupabase()
  let query = supabase.from('sf_registros').select(COLUNAS, { count: 'exact' })

  if (filtros.cliente) query = query.eq('cliente', filtros.cliente)
  if (filtros.posto) query = query.eq('posto', filtros.posto)
  if (filtros.snNorm) query = query.eq('numero_serie_norm', filtros.snNorm)
  if (filtros.status) {
    query = filtros.status === 'sem-status'
      ? query.eq('status', '')
      : query.eq('status', filtros.status)
  }
  if (filtros.busca) {
    const b = filtros.busca.replace(/[%,]/g, '') // evita quebrar o padrão do .or()
    query = query.or(`pmo.ilike.%${b}%,op.ilike.%${b}%`)
  }
  if (filtros.de) query = query.gte('data_hora', filtros.de)
  if (filtros.ate) query = query.lte('data_hora', filtros.ate)

  const inicio = pagina * tamanho
  const fim = inicio + tamanho - 1
  const { data, error, count } = await query
    .order('data_hora', { ascending: false })
    .range(inicio, fim)
  if (error) throw error
  return { linhas: (data ?? []) as RegistroRow[], total: count ?? 0 }
}

/** Clientes para o dropdown. Fonte = sf_ordens (tabela pequena) — clientes com
 *  registros são um subconjunto; filtrar por um sem registros só mostra vazio. */
export async function listarClientesRegistros(): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').select('cliente')
  if (error) throw error
  const set = new Set(
    (data ?? []).map((r) => (r as { cliente: string }).cliente).filter(Boolean),
  )
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
