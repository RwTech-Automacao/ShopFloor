import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Placas por painel no NQA (0166): a amostra da Tabela NQA é calculada sobre as PLACAS da caixa/lote
 * (decisão do usuário, 27/10). Caixa de 10 painéis × 50 = 500 placas → faixa de 500, não de 10.
 */
const SESSAO_OK = {
  usuarioId: 'u1', nome: 'Qualidade', email: 'qa@x',
  perfil: { porModulo: { shopfloor: { lancar: true } }, permissoes: {} },
}
// Faixas de verdade (nível II): 2–8 → 2, 9–15 → 3, 151–280 → 32, 281–500 → 50.
const TABELA = [
  { quantidadeMin: 2, quantidadeMax: 8, tamanhoAmostra: 2 },
  { quantidadeMin: 9, quantidadeMax: 15, tamanhoAmostra: 3 },
  { quantidadeMin: 16, quantidadeMax: 150, tamanhoAmostra: 20 },
  { quantidadeMin: 151, quantidadeMax: 280, tamanhoAmostra: 32 },
  { quantidadeMin: 281, quantidadeMax: 500, tamanhoAmostra: 50 },
]
const PERFIS = {
  Teste: { recurso: 'nenhum' },
  Embalagem: { recurso: 'caixa' },
  'Inspeção NQA': { recurso: 'nqa' },
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.doUnmock('@/modules/shopfloor/infra/caixa-repository')
  vi.doUnmock('@/modules/shopfloor/infra/postos-repository')
  vi.doUnmock('@/modules/recebimento/infra/referencias-repository')
  vi.resetModules()
})

function mocksComuns() {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => SESSAO_OK }))
  vi.doMock('@/modules/recebimento/infra/referencias-repository', () => ({ carregarTabelaNqa: async () => TABELA }))
  vi.doMock('@/modules/shopfloor/infra/postos-repository', () => ({ mapaPostoPerfil: async () => PERFIS }))
}

describe('carregarNqaCaixa — amostra pelas placas da caixa', () => {
  function caixa(qtd: number, pecas: number, n: number) {
    const sns = Array.from({ length: n }, (_, i) => `P${i}`)
    return {
      posto: 'Embalagem', numeroCaixa: 'CX[1][500]7101-PMOP1', qtd, snsNorm: sns,
      pecasPorSn: Object.fromEntries(sns.map((s) => [s, pecas])),
      fechada: true, aposentada: false, jaInspecionadaNqa: false, pendentesReteste: [], postoReteste: '',
    }
  }

  it('10 painéis × 50 = 500 placas → amostra da faixa de 500 (50), e o peso de cada SN vai junto', async () => {
    mocksComuns()
    vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({ resolverCaixaPorSn: async () => caixa(500, 50, 10) }))
    const { carregarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await carregarNqaCaixa('PMOP1', '7101', 'Inspeção NQA', 'P0')
    if (!r.ok) throw new Error(r.erro)
    expect(r.caixa.qtd).toBe(500)
    expect(r.caixa.amostra).toBe(50)
    expect(r.caixa.snsNorm).toHaveLength(10)
    expect(r.caixa.pecasPorSn.P3).toBe(50)
  })

  it('N = 1: 10 peças → amostra da faixa de 10 (3), como antes', async () => {
    mocksComuns()
    vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({ resolverCaixaPorSn: async () => caixa(10, 1, 10) }))
    const { carregarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await carregarNqaCaixa('PMOP1', '7101', 'Inspeção NQA', 'P0')
    if (!r.ok) throw new Error(r.erro)
    expect(r.caixa.qtd).toBe(10)
    expect(r.caixa.amostra).toBe(3)
  })
})

describe('carregarLoteNqaIndividual — qtd e amostra em placas', () => {
  /** Registros do lote (mais recente primeiro). Cada SN tem Teste + Embalagem; o 1º tem defeito e reparo. */
  function registros(sns: string[], pecas: number | undefined) {
    const linhas: Record<string, unknown>[] = []
    sns.forEach((s, i) => {
      const base = { numero_serie_norm: s, posto_retorno: null, ...(pecas === undefined ? {} : { pecas }) }
      linhas.push({ ...base, posto: 'Embalagem', data_hora: `2026-10-27T10:0${i}:00Z` })
      linhas.push({ ...base, posto: 'Teste', data_hora: `2026-10-27T09:0${i}:00Z` })
      if (i === 0) {
        linhas.push({ ...base, posto: 'Teste', data_hora: '2026-10-27T08:30:00Z' })
        linhas.push({ ...base, posto: 'Manutenção', data_hora: '2026-10-27T08:20:00Z' })
      }
    })
    return linhas
  }
  function mockSupabase(linhas: Record<string, unknown>[]) {
    vi.doMock('@/shared/lib/supabase/server', () => ({
      createServerSupabase: async () => ({
        from: () => {
          let sns: string[] = []
          const b: Record<string, unknown> = {}
          b.select = () => b
          b.eq = () => b
          b.in = (_c: string, v: string[]) => { sns = v; return b }
          b.order = () => b
          b.range = () => b
          b.then = (res: (x: unknown) => unknown) =>
            res({ data: linhas.filter((l) => sns.includes(l.numero_serie_norm as string)), error: null })
          return b
        },
      }),
    }))
  }

  it('4 painéis × 50 (com defeito e reparo repetindo o SN) = 200 placas → amostra 32', async () => {
    mocksComuns()
    mockSupabase(registros(['9001', '9002', '9003', '9004'], 50))
    const { carregarLoteNqaIndividual } = await import('../nqa-individual-actions')
    const r = await carregarLoteNqaIndividual('PMOP2', '7102', 'Inspeção NQA', ['9001', '9002', '9003', '9004'])
    if (!r.ok) throw new Error(r.erro)
    expect(r.lote.qtd).toBe(200)
    expect(r.lote.amostra).toBe(32)
    expect(r.lote.snsNorm).toHaveLength(4)
    expect(r.lote.pecasPorSn).toEqual({ '9001': 50, '9002': 50, '9003': 50, '9004': 50 })
  })

  it('N = 1 (sem a coluna pecas): qtd = nº de SNs e amostra da faixa de 4 (2), como antes', async () => {
    mocksComuns()
    mockSupabase(registros(['9001', '9002', '9003', '9004'], undefined))
    const { carregarLoteNqaIndividual } = await import('../nqa-individual-actions')
    const r = await carregarLoteNqaIndividual('PMOP2', '7102', 'Inspeção NQA', ['9001', '9002', '9003', '9004'])
    if (!r.ok) throw new Error(r.erro)
    expect(r.lote.qtd).toBe(4)
    expect(r.lote.amostra).toBe(2)
  })
})
