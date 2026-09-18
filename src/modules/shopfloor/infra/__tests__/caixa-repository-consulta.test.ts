import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Supabase de mentira: `sf_caixas` devolve as caixas; `sf_registros` respeita o `.range()` e corta em
// 1000 linhas por consulta, como o PostgREST (max_rows).
const MAX_ROWS = 1000
let caixas: Record<string, unknown>[] = []
let registros: Record<string, unknown>[] = []

function consulta(tabela: string) {
  let de = 0
  let ate = Number.POSITIVE_INFINITY
  const q = {
    select: () => q,
    eq: () => q,
    like: () => q,
    order: () => q,
    range(a: number, b: number) {
      de = a
      ate = b
      return q
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      const fonte = tabela === 'sf_caixas' ? caixas : registros
      const fim = Math.min(ate + 1, de + MAX_ROWS)
      const data = tabela === 'sf_caixas' ? fonte : fonte.slice(de, fim)
      return Promise.resolve({ data, error: null }).then(ok, erro)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from: consulta }),
}))

const { carregarCaixasDaOp } = await import('../caixa-repository')

function caixaFechada(seq: number) {
  return { seq, posto: 'Embalagem', limite: 120, fechada: true, codigo: `CX[${seq}][120]8495-PMOC13`, revisao: 0 }
}

describe('carregarCaixasDaOp', () => {
  beforeEach(() => {
    caixas = []
    registros = []
  })

  it('traz as peças de TODAS as caixas mesmo com mais de 1000 registros na OP', async () => {
    // 10 caixas de 120 = 1200 registros: sem paginar, a CX[9] vinha pela metade e a CX[10] vazia.
    for (let seq = 1; seq <= 10; seq++) {
      caixas.push(caixaFechada(seq))
      for (let i = 0; i < 120; i++) {
        const sn = String(332000000 + seq * 1000 + i)
        registros.push({ numero_serie: sn, numero_serie_norm: sn, numero_caixa: `CX[${seq}][120]8495-PMOC13`, posto: 'Embalagem' })
      }
    }

    const r = await carregarCaixasDaOp('PMOC13', '8495')

    expect(r.map((c) => c.qtd)).toEqual(Array(10).fill(120))
  })
})
