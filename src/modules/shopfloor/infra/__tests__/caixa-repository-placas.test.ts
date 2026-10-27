import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Supabase de mentira em memória: `sf_caixas`, `sf_registros` (sem filtro: o teste só põe linhas da OP/posto).
let caixas: Record<string, unknown>[] = []
let registros: Record<string, unknown>[] = []

function consulta(tabela: string) {
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    like: () => q,
    order: () => q,
    range: () => q,
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      return Promise.resolve({ data: tabela === 'sf_caixas' ? caixas : registros, error: null }).then(ok, erro)
    },
  }
  return q
}
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ from: consulta }) }))
vi.mock('../postos-repository', () => ({ mapaPostoPerfil: async () => ({}) }))

const { carregarCaixasDaOp, carregarEstadoEmbalagem } = await import('../caixa-repository')

const linha = (sn: string, caixa: string, pecas?: number) =>
  ({ numero_serie: sn, numero_serie_norm: sn, numero_caixa: caixa, posto: 'Embalagem', ...(pecas === undefined ? {} : { pecas }) })

describe('caixa em placas (repositório)', () => {
  beforeEach(() => { caixas = []; registros = [] })

  it('carregarCaixasDaOp: qtd = placas (cada SN uma vez); sns.length = painéis', async () => {
    caixas = [{ seq: 1, posto: 'Embalagem', limite: 500, fechada: true, codigo: 'CX[1][100]1-P', revisao: 0 }]
    // 2 painéis de 50 placas; o SN A tem uma 2ª linha (retorno) que não pode dobrar a conta
    registros = [linha('A', 'CX[1][100]1-P', 50), linha('B', 'CX[1][100]1-P', 50), linha('A', 'CX[1][100]1-P', 50)]
    const [c] = await carregarCaixasDaOp('P', '1')
    expect(c!.qtd).toBe(100)
    expect(c!.sns).toHaveLength(2)
  })

  it('N=1 (ou linhas sem pecas): qtd = nº de SNs distintos, como antes', async () => {
    caixas = [{ seq: 1, posto: 'Embalagem', limite: 3, fechada: true, codigo: 'CX[1][2]1-P', revisao: 0 }]
    registros = [linha('A', 'CX[1][2]1-P'), linha('B', 'CX[1][2]1-P', 1), linha('B', 'CX[1][2]1-P', 1)]
    const [c] = await carregarCaixasDaOp('P', '1')
    expect(c!.qtd).toBe(2)
  })

  it('carregarEstadoEmbalagem: placas na caixa e total, com SN repetido contado uma vez', async () => {
    caixas = [{ seq: 1, limite: 500, fechada: false, ultima: false, revisao: 0, codigo: '' }]
    registros = [linha('A', 'CX[1]', 50), linha('B', 'CX[1]', 50), linha('B', 'CX[1]', 50)]
    const e = await carregarEstadoEmbalagem('P', '1', 'Embalagem')
    expect(e.qtdNaCaixa).toBe(100)
    expect(e.totalEmbaladas).toBe(100)
    expect(e.snsNaCaixa).toHaveLength(2)
    expect(e.caixasAbertas[0]!.qtd).toBe(100)
  })
})
