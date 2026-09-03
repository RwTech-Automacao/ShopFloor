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
  posto_retorno: string | null // reteste do NQA: rota de postos que a peça repassa (+ NQA no fim)
}

export interface ResultadoRegistros {
  linhas: RegistroRow[]
  total: number
}

const COLUNAS =
  'id,data_hora,colaborador,posto,pmo,op,cliente,numero_caixa,qtd_por_caixa,status,numero_serie,codigo_defeito,posicao,tipo_defeito,nqa_visual,nqa_funcional,id_integracao,reparo_conserto,reparo_posicao,posto_origem,data_hora_origem,posto_retorno'

/** Teto de linhas por requisição do PostgREST (PGRST_DB_MAX_ROWS). Páginas maiores viram blocos. */
const BLOCO_POSTGREST = 1000

export async function consultarRegistros(
  filtros: FiltrosRegistros,
  pagina: number,
  tamanho: number,
): Promise<ResultadoRegistros> {
  const supabase = await createServerSupabase()

  // O builder do supabase-js é de uso único → cada bloco precisa de uma consulta nova.
  const base = () => {
    let query = supabase.from('sf_registros').select(COLUNAS, { count: 'exact' })
    if (filtros.cliente) query = query.eq('cliente', filtros.cliente)
    if (filtros.posto) query = query.eq('posto', filtros.posto)
    if (filtros.snNorm) query = query.eq('numero_serie_norm', filtros.snNorm)
    if (filtros.status) {
      // `status` é gravado capitalizado no banco ('Aprovado'/'Reprovado') e o filtro da tela manda
      // minúsculo. `eq` diferencia maiúsculas → não casava NADA (o filtro vinha vazio). `ilike` sem
      // curinga casa exato, ignorando a caixa.
      query = filtros.status === 'sem-status'
        ? query.eq('status', '')
        : query.ilike('status', filtros.status)
    }
    if (filtros.busca) {
      const b = filtros.busca.replace(/[%,]/g, '') // evita quebrar o padrão do .or()
      query = query.or(`pmo.ilike.%${b}%,op.ilike.%${b}%`)
    }
    if (filtros.de) query = query.gte('data_hora', filtros.de)
    if (filtros.ate) query = query.lte('data_hora', filtros.ate)
    return query.order('data_hora', { ascending: false }).order('id', { ascending: false })
  }

  const inicio = pagina * tamanho

  if (tamanho <= BLOCO_POSTGREST) {
    const { data, error, count } = await base().range(inicio, inicio + tamanho - 1)
    if (error) throw error
    return { linhas: (data ?? []) as RegistroRow[], total: count ?? 0 }
  }

  // Página grande ("250/500/750/todos"): o PostgREST corta em BLOCO_POSTGREST por requisição,
  // então busca em blocos até completar o tamanho pedido (ou acabar o resultado).
  const linhas: RegistroRow[] = []
  let total = 0
  for (let off = 0; off < tamanho; off += BLOCO_POSTGREST) {
    const de = inicio + off
    const ate = Math.min(de + BLOCO_POSTGREST, inicio + tamanho) - 1
    const { data, error, count } = await base().range(de, ate)
    if (error) throw error
    if (off === 0) total = count ?? 0
    const lote = (data ?? []) as RegistroRow[]
    linhas.push(...lote)
    if (lote.length < ate - de + 1) break // chegou ao fim do resultado
  }
  return { linhas, total }
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

/** Teto de segurança do export — evita puxar a base inteira sem querer. */
export const MAX_EXPORT = 50_000

/**
 * TODAS as linhas que casam com os filtros, pra exportar em planilha. Busca em blocos (o PostgREST
 * corta em 1000 por requisição) até acabar o resultado ou bater o teto. Devolve também se truncou.
 */
export async function listarTodosRegistros(
  filtros: FiltrosRegistros,
  teto = MAX_EXPORT,
): Promise<{ linhas: RegistroRow[]; truncado: boolean }> {
  const linhas: RegistroRow[] = []
  for (let pagina = 0; linhas.length < teto; pagina++) {
    const { linhas: lote } = await consultarRegistros(filtros, pagina, BLOCO_POSTGREST)
    linhas.push(...lote)
    if (lote.length < BLOCO_POSTGREST) return { linhas, truncado: false }
  }
  return { linhas: linhas.slice(0, teto), truncado: true }
}
