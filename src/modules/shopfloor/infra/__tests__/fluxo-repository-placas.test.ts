import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Supabase de mentira: aplica os `.eq()` nas linhas da tabela (é o que decide se a caixa aposentada
 * pelo NQA entra na conta), respeita `.range()` como o PostgREST e atende o `count/head` da contagem
 * de caixas fechadas. `sf_ordens` volta pelo `maybeSingle`; a RPC sf_fluxo_op volta o agregado cru.
 */
const MAX_ROWS = 1000
let ordem: Record<string, unknown> | null = null
let registros: Record<string, unknown>[] = []
let caixas: Record<string, unknown>[] = []
let agregados: Record<string, unknown>[] = []
let perfis: Record<string, { temStatus: boolean; recurso: string; exigeManutencao: boolean }> = {}
let consultasEmCaixas = 0
let colunasPedidas: string[] = []

vi.mock('../postos-repository', () => ({ mapaPostoPerfil: async () => perfis }))

function consulta(tabela: string) {
  if (tabela === 'sf_caixas') consultasEmCaixas += 1
  const filtros: [string, unknown][] = []
  let head = false
  let de = 0
  let ate = Number.POSITIVE_INFINITY
  const q = {
    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      colunasPedidas.push(`${tabela}:${cols ?? ''}`)
      head = opts?.head === true
      return q
    },
    eq(col: string, val: unknown) {
      filtros.push([col, val])
      return q
    },
    neq: () => q,
    order: () => q,
    range(a: number, b: number) {
      de = a
      ate = b
      return q
    },
    maybeSingle: () => Promise.resolve({ data: ordem, error: null }),
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      const fonte = tabela === 'sf_caixas' ? caixas : registros
      const filtrado = fonte.filter((r) => filtros.every(([c, v]) => r[c] === v))
      if (head) return Promise.resolve({ data: null, count: filtrado.length, error: null }).then(ok, erro)
      const fim = Math.min(ate + 1, de + MAX_ROWS)
      return Promise.resolve({ data: filtrado.slice(de, fim), error: null }).then(ok, erro)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    from: consulta,
    rpc: async () => ({ data: agregados, error: null }),
  }),
}))

const { carregarFluxoOp } = await import('../fluxo-repository')

const PMO = 'PMO1'
const OP = '9000'

let seq = 0
function registro(posto: string, sn: string, status: string, pecas: number, minuto: number) {
  seq += 1
  return { pmo: PMO, op: OP, posto, numero_serie: sn, numero_serie_norm: sn, status, posto_retorno: null, data_hora: `2026-10-20T10:${String(minuto).padStart(2, '0')}:00Z`, id: seq, pecas }
}

describe('carregarFluxoOp — placas por painel (fila, iniciadas e não iniciadas em placas)', () => {
  beforeEach(() => {
    seq = 0
    perfis = {
      Montagem: { temStatus: false, recurso: 'nenhum', exigeManutencao: false },
      Teste: { temStatus: true, recurso: 'nenhum', exigeManutencao: true },
    }
    ordem = { qtd: 500, embalagem_individual: true, sf_ordem_postos: [{ posto: 'Montagem', ordem: 1 }, { posto: 'Teste', ordem: 2 }] }
    caixas = []
    agregados = []
  })

  const doPosto = (r: Awaited<ReturnType<typeof carregarFluxoOp>>, posto: string) => r.agregados.find((a) => a.posto === posto)!

  it('N=50: cada painel conta 50 placas uma vez, mesmo com linhas de defeito, reparo e reteste', async () => {
    registros = [
      // P1: montado, aguarda o Teste.
      registro('Montagem', 'P1', '', 50, 0),
      // P2: montado, reprovado com 2 linhas de defeito → aguarda na Manutenção.
      registro('Montagem', 'P2', '', 50, 1),
      registro('Teste', 'P2', 'Reprovado', 50, 2), registro('Teste', 'P2', 'Reprovado', 50, 2),
      // P3: reprovado, reparo com 2 linhas, reteste aprovado → concluiu o fluxo.
      registro('Montagem', 'P3', '', 50, 3),
      registro('Teste', 'P3', 'Reprovado', 50, 4),
      registro('Manutenção', 'P3', '', 50, 5), registro('Manutenção', 'P3', '', 50, 5),
      registro('Teste', 'P3', 'Aprovado', 50, 6),
    ]
    const r = await carregarFluxoOp(PMO, OP)
    expect(r.finalizadas).toBe(50)
    expect(r.naoIniciadas).toBe(500 - 150) // qtd em placas − 3 painéis × 50
    expect(doPosto(r, 'Teste').wip).toBe(50) // P1
    expect(doPosto(r, 'Manutenção').wip).toBe(50) // P2
    expect(doPosto(r, 'Montagem').wip).toBe(350) // as não iniciadas aguardam no 1º posto
  })

  it('N=1: idêntico à contagem por peça de antes', async () => {
    ordem = { ...(ordem as object), qtd: 10 } as Record<string, unknown>
    registros = [
      registro('Montagem', 'P1', '', 1, 0),
      registro('Montagem', 'P2', '', 1, 1),
      registro('Teste', 'P2', 'Reprovado', 1, 2), registro('Teste', 'P2', 'Reprovado', 1, 2),
      registro('Montagem', 'P3', '', 1, 3),
      registro('Teste', 'P3', 'Aprovado', 1, 4),
    ]
    const r = await carregarFluxoOp(PMO, OP)
    expect(r.finalizadas).toBe(1)
    expect(r.naoIniciadas).toBe(7)
    expect(doPosto(r, 'Teste').wip).toBe(1)
    expect(doPosto(r, 'Manutenção').wip).toBe(1)
    expect(doPosto(r, 'Montagem').wip).toBe(7)
  })

  it('pede a coluna pecas no scan dos registros', async () => {
    registros = [registro('Montagem', 'P1', '', 50, 0)]
    await carregarFluxoOp(PMO, OP)
    expect(colunasPedidas.some((c) => c.startsWith('sf_registros:') && c.split(',').includes('pecas'))).toBe(true)
  })
})
