import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Placas por painel (0165): o diálogo de cancelamento diz quantas PLACAS saem ("500 peças"), somando
// `pecas` das linhas da entrada (uma por SN) — e não contando linhas.

type Linha = { pecas: number }

/** Um query builder mínimo: from().select().eq()...order().range() devolve a fatia das linhas. */
function supabaseCom(tabelas: Record<string, unknown[]>) {
  const chamadas: { tabela: string; select: string; filtros: [string, unknown][] }[] = []
  return {
    chamadas,
    cliente: {
      from(tabela: string) {
        const c = { tabela, select: '', filtros: [] as [string, unknown][] }
        chamadas.push(c)
        const linhas = () => (tabelas[tabela] ?? []).filter((l) =>
          c.filtros.every(([k, v]) => (l as Record<string, unknown>)[k] === v))
        const b = {
          select(s: string) { c.select = s; return b },
          eq(k: string, v: unknown) { c.filtros.push([k, v]); return b },
          order() { return b },
          range(de: number, ate: number) {
            return Promise.resolve({ data: linhas().slice(de, ate + 1), error: null })
          },
          maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }) },
        }
        return b
      },
    },
  }
}

afterEach(() => {
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

describe('cancelamento-repository em placas', () => {
  it('contarPecasDaEntradaDeCaixa soma `pecas` das linhas da caixa (10 painéis × 50 = 500)', async () => {
    const linhas: (Linha & Record<string, unknown>)[] = Array.from({ length: 10 }, () => ({
      pmo: 'PMOZ01', op: '9601', posto: 'Almoxarifado', numero_caixa: 'CX[1][500]9601-PMOZ01', pecas: 50,
    }))
    linhas.push({ pmo: 'PMOZ01', op: '9601', posto: 'Almoxarifado', numero_caixa: 'CX[2][500]9601-PMOZ01', pecas: 50 })
    const sb = supabaseCom({ sf_registros: linhas })
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sb.cliente }))
    const { contarPecasDaEntradaDeCaixa } = await import('../cancelamento-repository')
    expect(await contarPecasDaEntradaDeCaixa('PMOZ01', '9601', 'Almoxarifado', 'CX[1][500]9601-PMOZ01')).toBe(500)
    expect(sb.chamadas[0]?.select).toBe('pecas')
  })

  it('contarPecasDaEntradaDeCaixa pagina (mais de 1000 linhas) e N = 1 continua sendo a contagem', async () => {
    const linhas = Array.from({ length: 1500 }, () => ({
      pmo: 'P', op: '1', posto: 'Almoxarifado', numero_caixa: 'CX[1][1500]1-P', pecas: 1,
    }))
    const sb = supabaseCom({ sf_registros: linhas })
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sb.cliente }))
    const { contarPecasDaEntradaDeCaixa } = await import('../cancelamento-repository')
    expect(await contarPecasDaEntradaDeCaixa('P', '1', 'Almoxarifado', 'CX[1][1500]1-P')).toBe(1500)
  })

  it('lerLoteDaEntrada: as placas do lote (4 painéis × 50 = 200)', async () => {
    const sb = supabaseCom({
      sf_estoque_envios: [{ id: 'e1', bipe: 'LOTE[abcd1234][4]', tipo: 'lote' }],
      sf_registros: Array.from({ length: 4 }, () => ({ envio_id: 'e1', pecas: 50 })),
    })
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sb.cliente }))
    const { lerLoteDaEntrada } = await import('../cancelamento-repository')
    expect(await lerLoteDaEntrada('e1')).toEqual({ rotulo: 'LOTE[abcd1234][4]', pecas: 200 })
  })
})
