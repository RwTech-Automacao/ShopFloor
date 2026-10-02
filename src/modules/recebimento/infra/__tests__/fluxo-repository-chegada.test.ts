import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Supabase de mentira para `processos_recebimento`, com as regras do PostgREST que importam aqui:
 * `ilike` sem curinga casa exato ignorando a caixa, `not(col, 'is', null)` tira os nulos, `order`
 * ordena de verdade e `limit` corta. Assim o teste exercita a CONSULTA que a função monta — se a
 * ordenação virar descendente, ou os nulos deixarem de ser filtrados, o resultado muda.
 */
interface Linha { numero_emb: string | null; data_chegada: string | null }
let linhas: Linha[] = []

function consulta(tabela: string) {
  let filtradas: Linha[] = tabela === 'processos_recebimento' ? [...linhas] : []
  const q = {
    select: () => q,
    ilike(coluna: keyof Linha, termo: string) {
      // Sem curinga: comparação exata, sem caixa. Os escapes do chamador saem antes de comparar.
      const alvo = termo.replace(/\\(.)/g, '$1').toLowerCase()
      filtradas = filtradas.filter((l) => (l[coluna] ?? '').toLowerCase() === alvo)
      return q
    },
    not(coluna: keyof Linha, op: string, valor: unknown) {
      if (op === 'is' && valor === null) filtradas = filtradas.filter((l) => l[coluna] !== null)
      return q
    },
    order(coluna: keyof Linha, opcoes?: { ascending?: boolean }) {
      const sinal = opcoes?.ascending === false ? -1 : 1
      filtradas = [...filtradas].sort(
        (a, b) => sinal * String(a[coluna] ?? '').localeCompare(String(b[coluna] ?? '')),
      )
      return q
    },
    limit(n: number) {
      filtradas = filtradas.slice(0, n)
      return q
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      return Promise.resolve({ data: filtradas, error: null }).then(ok, erro)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from: consulta }),
}))

const { carregarChegadaEmb } = await import('../fluxo-repository')

describe('carregarChegadaEmb', () => {
  beforeEach(() => { linhas = [] })

  it('devolve a data quando todos os itens da EMB têm a mesma (o caso normal)', async () => {
    linhas = [
      { numero_emb: 'EMB390CA', data_chegada: '2026-09-02' },
      { numero_emb: 'EMB390CA', data_chegada: '2026-09-02' },
    ]
    expect(await carregarChegadaEmb('EMB390CA')).toBe('2026-09-02')
  })

  it('com datas divergentes na mesma EMB, mostra a MAIS ANTIGA', async () => {
    // Acontece quando a EMB é importada mais de uma vez (a correção redigita a data) ou quando
    // alguém edita a data de um item: o campo é por processo.
    linhas = [
      { numero_emb: 'EMB390CA', data_chegada: '2026-09-10' },
      { numero_emb: 'EMB390CA', data_chegada: '2026-09-02' },
      { numero_emb: 'EMB390CA', data_chegada: '2026-09-28' },
    ]
    expect(await carregarChegadaEmb('EMB390CA')).toBe('2026-09-02')
  })

  it('ignora os itens sem data, em vez de deixar o vazio ganhar', async () => {
    linhas = [
      { numero_emb: 'EMB390CA', data_chegada: null },
      { numero_emb: 'EMB390CA', data_chegada: '2026-09-15' },
    ]
    expect(await carregarChegadaEmb('EMB390CA')).toBe('2026-09-15')
  })

  it('devolve null quando nenhum item da EMB tem data', async () => {
    linhas = [{ numero_emb: 'EMB390CA', data_chegada: null }]
    expect(await carregarChegadaEmb('EMB390CA')).toBeNull()
  })

  it('não mistura a data de outra EMB, e casa a EMB sem olhar caixa nem espaços', async () => {
    linhas = [
      { numero_emb: 'EMB100AA', data_chegada: '2026-01-01' },
      { numero_emb: 'EMB390CA', data_chegada: '2026-09-02' },
    ]
    expect(await carregarChegadaEmb('  emb390ca  ')).toBe('2026-09-02')
  })

  it('EMB vazia não consulta nada', async () => {
    linhas = [{ numero_emb: 'EMB390CA', data_chegada: '2026-09-02' }]
    expect(await carregarChegadaEmb('   ')).toBeNull()
  })
})
