import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EstadoGrid } from '../../domain/estado-grid'

vi.mock('server-only', () => ({}))

/**
 * Os filtros rápidos (Divergências / positivas / negativas) filtram NO BANCO, e têm de filtrar
 * pela coluna GERADA `divergencia_num` (0147) — nunca pela `divergencia`, que é `text` e compara
 * como texto ('9' > '10', '-5' > '0'). Estes testes olham a consulta que sai: o operador e a
 * coluna exatos. Trocar `gt` por `gte`, ou `divergencia_num` por `divergencia`, derruba o arquivo.
 */

/** Cada chamada feita na consulta, na ordem: ['gt', ['divergencia_num', 0]], etc. */
const chamadas: [string, unknown[]][] = []
const tabelas: string[] = []

const METODOS = [
  'eq', 'neq', 'ilike', 'in', 'is', 'not', 'or',
  'gt', 'gte', 'lt', 'lte', 'filter', 'match', 'textSearch',
  'order', 'range', 'limit',
]

function consulta(tabela: string) {
  tabelas.push(tabela)
  const q: Record<string, unknown> = {}
  for (const metodo of METODOS) {
    q[metodo] = (...args: unknown[]) => {
      chamadas.push([metodo, args])
      return q
    }
  }
  q.select = () => q
  q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(ok, erro)
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from: consulta }),
}))

const { listarProcessosGrid, listarIdsGrid } = await import('../processo-repository')

/** Só as CONDIÇÕES sobre a divergência (ordenação e paginação ficam de fora). */
function condicoesDeDivergencia() {
  return chamadas.filter(
    ([metodo, args]) =>
      metodo !== 'order' && metodo !== 'range' && String(args[0]).startsWith('divergencia'),
  )
}

const BASE: EstadoGrid = { ordenar: 'numero', direcao: 'desc', pagina: 0, tamanho: 50, filtros: {} }
const TIPOS: Record<string, 'texto' | 'lista' | 'numero' | 'data'> = {
  numero: 'numero',
  fornecedor: 'texto',
}

function listar(estado: EstadoGrid) {
  return listarProcessosGrid({ estado, colunas: ['numero'], tiposPorCampo: TIPOS })
}

beforeEach(() => {
  chamadas.length = 0
  tabelas.length = 0
})

describe('montarQueryGrid: filtro rápido de divergência', () => {
  it.each([
    ['divergencias', 'neq'],
    ['positivas', 'gt'],
    ['negativas', 'lt'],
  ] as const)('%s vira exatamente %s em divergencia_num', async (rapido, operador) => {
    await listar({ ...BASE, rapido })
    expect(condicoesDeDivergencia()).toEqual([[operador, ['divergencia_num', 0]]])
  })

  it('sem filtro rápido não aplica condição nenhuma de divergência', async () => {
    await listar(BASE)
    // Prova positiva de que a consulta aconteceu — senão a lista vazia abaixo não valeria nada.
    expect(tabelas).toEqual(['processos_recebimento'])
    expect(chamadas.map(([m]) => m)).toContain('order')
    expect(condicoesDeDivergencia()).toEqual([])
  })

  it('o filtro rápido se soma ao filtro de coluna e à ordenação, numa só consulta', async () => {
    await listar({
      ordenar: 'fornecedor',
      direcao: 'asc',
      pagina: 0,
      tamanho: 50,
      filtros: { fornecedor: { texto: 'ACME' } },
      rapido: 'positivas',
    })
    expect(chamadas).toEqual([
      ['ilike', ['fornecedor', '%ACME%']],
      ['gt', ['divergencia_num', 0]],
      ['order', ['fornecedor', { ascending: true }]],
      ['order', ['numero', { ascending: false }]],
      ['range', [0, 49]],
    ])
  })

  it('ordenar PELA divergência não é filtrar: a ordem vai na coluna text, a condição na gerada', async () => {
    await listar({ ...BASE, ordenar: 'divergencia', rapido: 'negativas' })
    expect(chamadas).toEqual([
      ['lt', ['divergencia_num', 0]],
      ['order', ['divergencia', { ascending: false }]],
      ['order', ['numero', { ascending: false }]],
      ['range', [0, 49]],
    ])
  })

  it('as setas ‹ › andam na mesma lista: listarIdsGrid também aplica o filtro rápido', async () => {
    await listarIdsGrid({ ...BASE, rapido: 'divergencias' }, {})
    expect(condicoesDeDivergencia()).toEqual([['neq', ['divergencia_num', 0]]])
  })
})
