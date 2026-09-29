import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Supabase de mentira: cada RPC respeita `.range()` e corta em 1000 linhas por chamada, como o
// PostgREST (max_rows) — mesmo padrão de src/modules/shopfloor/infra/__tests__/caixa-repository-consulta.test.ts.
const MAX_ROWS = 1000
let linhas: Record<string, unknown>[] = []
let chamadas = 0

function rpc() {
  let de = 0
  let ate = Number.POSITIVE_INFINITY
  const q = {
    range(a: number, b: number) {
      de = a
      ate = b
      return q
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      chamadas += 1
      const fim = Math.min(ate + 1, de + MAX_ROWS)
      const data = linhas.slice(de, fim)
      return Promise.resolve({ data, error: null }).then(ok, erro)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => ({ rpc }) }))

const { criarLeitorServico } = await import('../leitura')

describe('criarLeitorServico', () => {
  beforeEach(() => {
    linhas = []
    chamadas = 0
  })

  it('sem linhas: uma chamada só, devolve lista vazia', async () => {
    const leitor = criarLeitorServico({ rpc } as never)
    const r = await leitor.lerRecebimentos()
    expect(r).toEqual([])
    expect(chamadas).toBe(1)
  })

  it('2500 linhas viram 3 chamadas (1000 + 1000 + 500), todas as linhas voltam', async () => {
    linhas = Array.from({ length: 2500 }, (_, i) => ({ id: `x${i}` }))
    const leitor = criarLeitorServico({ rpc } as never)
    const r = await leitor.lerOrdens()
    expect(chamadas).toBe(3)
    expect(r).toHaveLength(2500)
    expect(r[0]).toEqual({ id: 'x0' })
    expect(r[2499]).toEqual({ id: 'x2499' })
  })

  it('exatamente 1000 linhas: pede a página seguinte pra confirmar que acabou (2 chamadas)', async () => {
    linhas = Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}` }))
    const leitor = criarLeitorServico({ rpc } as never)
    const r = await leitor.lerRecebimentos()
    expect(chamadas).toBe(2)
    expect(r).toHaveLength(1000)
  })

  it('erro do Postgres na página lança (a leitura inteira falha, nada é montado)', async () => {
    const rpcComErro = () => ({
      range: () => ({
        then: (_ok: unknown, erro?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: 'connection refused' } }).then(_ok as never, erro),
      }),
    })
    const leitor = criarLeitorServico({ rpc: rpcComErro } as never)
    await expect(leitor.lerRecebimentos()).rejects.toThrow(/connection refused/)
  })
})
