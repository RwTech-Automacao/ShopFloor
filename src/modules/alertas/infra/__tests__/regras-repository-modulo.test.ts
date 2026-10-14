import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const eq = vi.fn()
const is = vi.fn()
const order = vi.fn()
const select = vi.fn()
const from = vi.fn()
const rpc = vi.fn()

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from, rpc }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Encadeamento do supabase-js: from().select().eq().is().order() devolve { data, error }.
  const cadeia = { select, eq, is, order, in: vi.fn() }
  select.mockReturnValue(cadeia)
  eq.mockReturnValue(cadeia)
  is.mockReturnValue(cadeia)
  order.mockResolvedValue({ data: [], error: null })
  from.mockReturnValue(cadeia)
  rpc.mockResolvedValue({ data: [], error: null })
})

describe('listarRegras por módulo', () => {
  it('filtra pela coluna modulo no servidor', async () => {
    const { listarRegras } = await import('../regras-repository')
    await listarRegras('recebimento')
    expect(eq).toHaveBeenCalledWith('modulo', 'recebimento')
  })

  it('pede a coluna modulo ao banco', async () => {
    const { listarRegras } = await import('../regras-repository')
    await listarRegras('shopfloor')
    expect(String(select.mock.calls[0]![0])).toContain('modulo')
  })
})

describe('as RPCs levam o módulo', () => {
  it('alerta_destinatarios recebe p_modulo', async () => {
    const { listarDestinatarios } = await import('../regras-repository')
    await listarDestinatarios('recebimento')
    expect(rpc).toHaveBeenCalledWith('alerta_destinatarios', { p_modulo: 'recebimento' })
  })

  it('alerta_listar_ocorrencias recebe p_modulo', async () => {
    const { listarOcorrencias } = await import('../regras-repository')
    await listarOcorrencias('recebimento', { de: '2026-10-01', ate: '2026-10-09', estado: '' })
    const args = rpc.mock.calls.find((c) => c[0] === 'alerta_listar_ocorrencias')![1] as Record<string, unknown>
    expect(args.p_modulo).toBe('recebimento')
  })
})
