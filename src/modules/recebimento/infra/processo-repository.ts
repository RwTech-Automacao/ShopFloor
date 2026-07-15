import { createServerSupabase } from '@/shared/lib/supabase/server'
import { sanitizarTermoBusca } from '../domain/busca-processo'
import { faixaDoMes, type EstadoGrid } from '../domain/estado-grid'
import { carregarCamposFormulario } from './processo-detalhe-repository'

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

export interface FiltrosProcessos {
  busca?: string
  status?: string
}

export interface ColunaGrid {
  campo: string
  rotulo: string
  tipo: 'texto' | 'lista' | 'numero' | 'data'
}

/** Colunas que existem em `processos_recebimento` mas NÃO em `configuracao_campos`
 *  (não são campos editáveis do processo) e ainda assim são exibíveis no grid. */
const COLUNAS_SISTEMA: ColunaGrid[] = [
  { campo: 'numero', rotulo: 'Número', tipo: 'numero' },
  { campo: 'status', rotulo: 'Status', tipo: 'texto' },
]

/**
 * Catálogo de colunas do grid: as de sistema + os campos ativos de
 * `configuracao_campos`. É a **whitelist** — nome de coluna vindo do cliente só é aceito
 * se estiver aqui.
 */
export async function carregarCatalogoColunas(): Promise<ColunaGrid[]> {
  const campos = await carregarCamposFormulario()
  return [
    ...COLUNAS_SISTEMA,
    ...campos.map((c) => ({ campo: c.campo, rotulo: c.rotulo, tipo: c.tipo })),
  ]
}

export interface ColunaLista {
  campo: string
  visivel: boolean
  ordem: number
}

/** Layout da lista (config geral): quais colunas aparecem e em que ordem. */
export async function listarColunasLista(): Promise<ColunaLista[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('colunas_lista')
    .select('campo, visivel, ordem')
    .order('ordem', { ascending: true })
  if (error) throw error
  return (data ?? []) as ColunaLista[]
}

/** Valores distintos de uma coluna, para o checkbox do filtro. Em coluna de data, vêm
 *  os MESES ('YYYY-MM' / 'sem_data'). Teto de 200 na RPC — o resto se acha pela busca. */
export async function valoresDistintosColuna(campo: string): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('valores_distintos_processos', {
    p_coluna: campo,
    p_limite: 200,
  })
  if (error) throw error
  return ((data ?? []) as { valor: string }[]).map((r) => r.valor)
}

/**
 * Uma página do grid, com filtro e ordenação aplicados **no banco** — o resultado vale
 * sobre a base inteira, não sobre o que já estava carregado (requisito: filtrar na página
 * 1 tem que achar o que estaria na "página 10").
 *
 * `colunas` já vem validado contra o catálogo pelo chamador; o SELECT traz só elas (+ id),
 * o que mantém o payload pequeno mesmo com 39 colunas possíveis.
 */
export async function listarProcessosGrid({
  estado,
  colunas,
  tiposPorCampo,
}: {
  estado: EstadoGrid
  colunas: string[]
  tiposPorCampo: Record<string, ColunaGrid['tipo']>
}): Promise<{ linhas: Record<string, unknown>[]; total: number }> {
  const supabase = await createServerSupabase()

  let query = supabase
    .from('processos_recebimento')
    .select(['id', ...colunas].join(', '), { count: 'exact' })

  for (const [campo, filtro] of Object.entries(estado.filtros)) {
    const tipo = tiposPorCampo[campo]
    // `.ilike` não existe para bigint/date no Postgres — um texto vindo do `?g=`
    // editado à mão viraria erro 400 e derrubaria a página. Só texto/lista buscam.
    if (filtro.texto && (tipo === 'texto' || tipo === 'lista')) {
      const termo = sanitizarTermoBusca(filtro.texto)
      if (termo) query = query.ilike(campo, `%${termo}%`)
    }
    if (filtro.valores && filtro.valores.length > 0) {
      if (tiposPorCampo[campo] === 'data') {
        // Em coluna de data os valores são MESES: cada um vira uma faixa
        // [1º do mês, 1º do mês seguinte); 'sem_data' vira `is null`. As condições só
        // contêm datas e literais nossos — nada digitado pelo usuário entra na string.
        const condicoes = filtro.valores.map((mes) => {
          const faixa = faixaDoMes(mes)
          return faixa
            ? `and(${campo}.gte.${faixa.inicio},${campo}.lt.${faixa.fim})`
            : `${campo}.is.null`
        })
        query = query.or(condicoes.join(','))
      } else {
        query = query.in(campo, filtro.valores)
      }
    }
  }

  const inicio = estado.pagina * estado.tamanho
  const { data, error, count } = await query
    .order(estado.ordenar, { ascending: estado.direcao === 'asc' })
    .range(inicio, inicio + estado.tamanho - 1)
  if (error) throw error

  return { linhas: (data ?? []) as unknown as Record<string, unknown>[], total: count ?? 0 }
}
