import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const resultado = vi.fn()
vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => {
    const cadeia: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq']) cadeia[m] = () => cadeia
    cadeia.range = () => resultado()
    return { from: () => cadeia }
  },
}))

const { contarLancadosNoPosto } = await import('../lancamento-repository')

beforeEach(() => resultado.mockReset())

const linha = (sn: string, status: string, dh: string, id: number, pecas: number) =>
  ({ numero_serie_norm: sn, status, data_hora: dh, id, pecas })

describe('contarLancadosNoPosto em placas', () => {
  it('soma pecas UMA vez por SN, mesmo com várias linhas (rebipe)', async () => {
    resultado.mockResolvedValue({
      data: [
        linha('A', 'aprovado', '2026-10-27T10:00:00Z', 1, 50),
        linha('A', 'aprovado', '2026-10-27T11:00:00Z', 2, 50),
        linha('B', 'aprovado', '2026-10-27T10:00:00Z', 3, 50),
      ],
      error: null,
    })
    expect(await contarLancadosNoPosto('P', '1', 'EMB')).toBe(100)
  })

  it('SN reprovado e depois aprovado conta 50 uma vez; reprovado por último não conta', async () => {
    resultado.mockResolvedValue({
      data: [
        linha('A', 'reprovado', '2026-10-27T10:00:00Z', 1, 50),
        linha('A', 'aprovado', '2026-10-27T11:00:00Z', 2, 50),
        linha('B', 'aprovado', '2026-10-27T10:00:00Z', 3, 50),
        linha('B', 'reprovado', '2026-10-27T11:00:00Z', 4, 50),
      ],
      error: null,
    })
    expect(await contarLancadosNoPosto('P', '1', 'EMB')).toBe(50)
  })

  it('N=1 (pecas=1) mantém a contagem por SN distinto', async () => {
    resultado.mockResolvedValue({
      data: [linha('A', 'aprovado', 'x', 1, 1), linha('A', 'aprovado', 'y', 2, 1), linha('B', '', 'x', 3, 1)],
      error: null,
    })
    expect(await contarLancadosNoPosto('P', '1', 'EMB')).toBe(2)
  })
})
