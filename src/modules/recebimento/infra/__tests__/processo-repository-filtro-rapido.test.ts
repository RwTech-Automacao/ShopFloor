import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { EstadoGrid } from '../../domain/estado-grid'

vi.mock('server-only', () => ({}))

/**
 * Os filtros rápidos (Todas / Positivas / Negativas / Resolvidas / Não Resolvidas) filtram NO BANCO, e têm de filtrar
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
    ['resolvidas', 'neq'],
    ['nao_resolvidas', 'neq'],
  ] as const)('%s tem como PRIMEIRA condição de divergência %s em divergencia_num', async (rapido, operador) => {
    await listar({ ...BASE, rapido })
    expect(condicoesDeDivergencia()[0]).toEqual([operador, ['divergencia_num', 0]])
  })

  it('"nenhum" (desligado) não aplica condição nenhuma — nem a do cancelado', async () => {
    await listar({ ...BASE, rapido: 'nenhum' })
    expect(chamadas.map(([m]) => m)).toContain('order')
    expect(condicoesDeDivergencia()).toEqual([])
    expect(chamadas.filter(([, a]) => a[0] === 'status')).toEqual([])
  })

  it.each(['divergencias', 'positivas', 'negativas', 'resolvidas', 'nao_resolvidas'] as const)(
    '%s exclui processo cancelado (uma única regra para os cinco)',
    async (rapido) => {
      await listar({ ...BASE, rapido })
      expect(chamadas.filter(([, a]) => a[0] === 'status')).toEqual([['neq', ['status', 'cancelado']]])
    },
  )

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
      ['neq', ['status', 'cancelado']],
      ['gt', ['divergencia_num', 0]],
      ['order', ['fornecedor', { ascending: true }]],
      ['order', ['numero', { ascending: false }]],
      ['range', [0, 49]],
    ])
  })

  it('ordenar PELA divergência não é filtrar: a ordem vai na coluna text, a condição na gerada', async () => {
    await listar({ ...BASE, ordenar: 'divergencia', rapido: 'negativas' })
    expect(chamadas).toEqual([
      ['neq', ['status', 'cancelado']],
      ['lt', ['divergencia_num', 0]],
      ['order', ['divergencia', { ascending: false }]],
      ['order', ['numero', { ascending: false }]],
      ['range', [0, 49]],
    ])
  })

  it('as setas ‹ › andam na mesma lista: listarIdsGrid também aplica o filtro rápido', async () => {
    await listarIdsGrid({ ...BASE, rapido: 'divergencias' }, {})
    expect(condicoesDeDivergencia()).toEqual([['neq', ['divergencia_num', 0]]])
    expect(chamadas).toContainEqual(['neq', ['status', 'cancelado']])
  })
})

/**
 * Semântica LINHA A LINHA: aplica as condições que saíram na consulta (eq/neq/gt/lt) a linhas
 * de exemplo, com a lógica do SQL — comparação com nulo nunca é verdadeira. Cada filtro tem um
 * controle positivo (linha que tem de entrar) e vários negativos (linhas que têm de ficar de fora).
 */
type Linha = { nome: string; divergencia_num: number | null; divergencia_justificativa: string; status: string }

const LINHAS: Linha[] = [
  { nome: 'pos-pendente', divergencia_num: 5, divergencia_justificativa: '', status: 'aberto' },
  { nome: 'pos-justificada', divergencia_num: 5, divergencia_justificativa: 'caiu da paleta', status: 'aberto' },
  { nome: 'neg-pendente', divergencia_num: -3, divergencia_justificativa: '', status: 'em_conferencia' },
  { nome: 'neg-justificada', divergencia_num: -3, divergencia_justificativa: 'faltou na NF', status: 'finalizado' },
  // A justificativa SOBREVIVE ao desaparecimento da divergência — e isso NÃO é "resolvida".
  { nome: 'sem-divergencia-justificada', divergencia_num: 0, divergencia_justificativa: 'texto antigo', status: 'aberto' },
  { nome: 'sem-divergencia', divergencia_num: 0, divergencia_justificativa: '', status: 'aberto' },
  { nome: 'nao-conferida', divergencia_num: null, divergencia_justificativa: '', status: 'aberto' },
  { nome: 'cancelada-pendente', divergencia_num: 5, divergencia_justificativa: '', status: 'cancelado' },
  { nome: 'cancelada-justificada', divergencia_num: -3, divergencia_justificativa: 'x', status: 'cancelado' },
]

async function nomesQueEntram(rapido: EstadoGrid['rapido']) {
  chamadas.length = 0
  await listar({ ...BASE, rapido })
  const condicoes = chamadas.filter(([m]) => ['eq', 'neq', 'gt', 'lt'].includes(m))
  return LINHAS.filter((linha) =>
    condicoes.every(([metodo, [campo, valor]]) => {
      const atual = (linha as Record<string, unknown>)[campo as string] as number | string | null
      if (atual === null) return false
      if (metodo === 'eq') return atual === valor
      if (metodo === 'neq') return atual !== valor
      if (metodo === 'gt') return (atual as number) > (valor as number)
      return (atual as number) < (valor as number)
    }),
  ).map((l) => l.nome)
}

describe('filtro rápido: quais linhas entram', () => {
  it('Todas Divergências: toda divergência, justificada ou não; cancelada e sem divergência ficam fora', async () => {
    expect(await nomesQueEntram('divergencias')).toEqual([
      'pos-pendente', 'pos-justificada', 'neg-pendente', 'neg-justificada',
    ])
  })

  it('Positivas', async () => {
    expect(await nomesQueEntram('positivas')).toEqual(['pos-pendente', 'pos-justificada'])
  })

  it('Negativas', async () => {
    expect(await nomesQueEntram('negativas')).toEqual(['neg-pendente', 'neg-justificada'])
  })

  it('Resolvidas: divergência COM justificativa — a justificativa solta de quem não tem divergência não conta', async () => {
    const entram = await nomesQueEntram('resolvidas')
    expect(entram).toEqual(['pos-justificada', 'neg-justificada'])
    expect(entram).not.toContain('sem-divergencia-justificada')
    expect(entram).not.toContain('cancelada-justificada')
  })

  it('Não Resolvidas: divergência SEM justificativa; a cancelada fica de fora', async () => {
    const entram = await nomesQueEntram('nao_resolvidas')
    expect(entram).toEqual(['pos-pendente', 'neg-pendente'])
    expect(entram).not.toContain('cancelada-pendente')
    expect(entram).not.toContain('nao-conferida')
  })

  it('Resolvidas e Não Resolvidas particionam as divergências não canceladas', async () => {
    const r = await nomesQueEntram('resolvidas')
    const n = await nomesQueEntram('nao_resolvidas')
    const todas = await nomesQueEntram('divergencias')
    expect([...r, ...n].sort()).toEqual([...todas].sort())
  })

  it('Desligado: todas as linhas, inclusive cancelada e sem divergência', async () => {
    expect(await nomesQueEntram('nenhum')).toHaveLength(LINHAS.length)
  })
})
