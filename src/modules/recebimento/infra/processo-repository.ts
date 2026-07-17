import { createServerSupabase } from '@/shared/lib/supabase/server'
import { sanitizarTermoBusca } from '../domain/busca-processo'
import { faixaDoMes, type EstadoGrid } from '../domain/estado-grid'
import type { ColunaLayout } from '../domain/layout-colunas'
import { carregarCamposFormulario } from './processo-detalhe-repository'

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
    // `campo` desempata: uma linha órfã (campo desativado e depois reativado) pode
    // reaparecer com a ordem antiga e empatar com a coluna que ocupa a posição hoje.
    .order('ordem', { ascending: true })
    .order('campo', { ascending: true })
  if (error) throw error
  return (data ?? []) as ColunaLista[]
}

/** Grava o layout inteiro da lista (upsert por `campo`). A RLS exige `administrar`. */
export async function salvarColunasLista(layout: ColunaLayout[]): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('colunas_lista')
    .upsert(
      layout.map((c) => ({ campo: c.campo, visivel: c.visivel, ordem: c.ordem })),
      { onConflict: 'campo' },
    )
  if (error) throw error
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

type ClienteSupabase = Awaited<ReturnType<typeof createServerSupabase>>

/**
 * Monta a query do grid: SELECT + filtros + ordenação. É o ÚNICO lugar onde a regra de
 * filtro/ordem vive — a lista e as setas (vizinhos) chamam esta mesma função, então é
 * estruturalmente impossível elas divergirem. Só a paginação (.range) fica no chamador.
 */
function montarQueryGrid(
  supabase: ClienteSupabase,
  select: string,
  estado: EstadoGrid,
  tiposPorCampo: Record<string, ColunaGrid['tipo']>,
) {
  let query = supabase.from('processos_recebimento').select(select, { count: 'exact' })

  for (const [campo, filtro] of Object.entries(estado.filtros)) {
    const tipo = tiposPorCampo[campo]
    // `.ilike` não existe para bigint/date no Postgres — um texto vindo do `?g=`
    // editado à mão viraria erro 400 e derrubaria a página. Só texto/lista buscam.
    if (filtro.texto && (tipo === 'texto' || tipo === 'lista')) {
      const termo = sanitizarTermoBusca(filtro.texto)
      if (termo) query = query.ilike(campo, `%${termo}%`)
    }
    if (filtro.valores && filtro.valores.length > 0) {
      if (tipo === 'data') {
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

  const ordenada = query.order(estado.ordenar, { ascending: estado.direcao === 'asc' })
  // `numero` desempata. Sem isto, colunas com valores repetidos (status, fornecedor,
  // data_chegada) saem em ordem NÃO-determinística: a consulta paginada (top-N) e a de
  // ids (sort completo) podem resolver os empates diferente — a seta levaria a um
  // processo que não é o da linha seguinte do grid. Também é o que faz a paginação da
  // lista ser estável (sem isso, uma linha pode repetir ou sumir entre páginas).
  return estado.ordenar === 'numero'
    ? ordenada
    : ordenada.order('numero', { ascending: false })
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

  const inicio = estado.pagina * estado.tamanho
  const { data, error, count } = await montarQueryGrid(
    supabase,
    ['id', ...colunas].join(', '),
    estado,
    tiposPorCampo,
  ).range(inicio, inicio + estado.tamanho - 1)
  if (error) throw error

  return { linhas: (data ?? []) as unknown as Record<string, unknown>[], total: count ?? 0 }
}

/** O PostgREST corta cada resposta em `max_rows` (`supabase/config.toml`: 1000). É o
 *  tamanho de cada bloco em `listarIdsGrid`. */
const MAX_LINHAS_POR_BLOCO = 1000

/**
 * Teto das setas: acima disso elas desabilitam em vez de mentir. Buscamos os ids em blocos
 * de `MAX_LINHAS_POR_BLOCO` (o corte do PostgREST) até chegar aqui — com ~centenas de
 * processos/mês isso dá ~1 ano+ de folga. Passando disso, o keyset/seek (com índices) vira
 * um projeto próprio. NÃO subimos o `max_rows` global (toda query sem paginação passaria a
 * poder devolver milhares de linhas).
 */
export const TETO_VIZINHOS = 5000

/**
 * Ids do grid na MESMA ordem e com os MESMOS filtros da lista, sem paginação de tela — é o
 * que permite as setas ‹ › andarem exatamente como o grid mostra (inclusive atravessando
 * página). Usa `montarQueryGrid`, então não há como divergir da lista.
 *
 * Busca em BLOCOS de `MAX_LINHAS_POR_BLOCO` porque o PostgREST corta cada resposta nesse
 * tamanho. O caso comum (conjunto < 1 bloco) faz **1 requisição**, idêntico a antes; só um
 * conjunto grande faz alguns blocos a mais, e a busca para assim que um bloco vem incompleto
 * (fim da lista) ou ao atingir `TETO_VIZINHOS`. A ordem estável entre blocos depende do
 * desempate `.order('numero')` de `montarQueryGrid` — sem ele os blocos se sobreporiam.
 *
 * Devolve também o `total` (count exato no banco, não o tamanho do que veio): é ele que diz
 * se o conjunto estourou o teto (`total > TETO_VIZINHOS` → o chamador desabilita as setas).
 */
export async function listarIdsGrid(
  estado: EstadoGrid,
  tiposPorCampo: Record<string, ColunaGrid['tipo']>,
): Promise<{ ids: string[]; total: number }> {
  const supabase = await createServerSupabase()
  const ids: string[] = []
  let total = 0

  for (let inicio = 0; inicio < TETO_VIZINHOS; inicio += MAX_LINHAS_POR_BLOCO) {
    const fim = Math.min(inicio + MAX_LINHAS_POR_BLOCO, TETO_VIZINHOS) - 1
    const { data, error, count } = await montarQueryGrid(
      supabase,
      'id',
      estado,
      tiposPorCampo,
    ).range(inicio, fim)
    if (error) throw error
    if (count !== null) total = count
    const bloco = ((data ?? []) as unknown as { id: string }[]).map((r) => r.id)
    ids.push(...bloco)
    // Bloco incompleto = fim da lista; nada além disso para buscar.
    if (bloco.length < fim - inicio + 1) break
  }

  return { ids, total }
}
