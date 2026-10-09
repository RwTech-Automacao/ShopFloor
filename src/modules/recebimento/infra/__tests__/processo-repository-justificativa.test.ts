import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * O nome de quem justificou vem da PRÓPRIA linha do processo (coluna denormalizada, 0142).
 * A policy de leitura de `usuarios` só deixa ler a si mesmo ou quem administra o SISTEMA, então
 * resolver o nome lá faria o nome sumir para quem só administra o Recebimento.
 */
const tabelasLidas: string[] = []
const selects: string[] = []
let linhasDoBanco: Record<string, unknown>[] = []

function consulta(tabela: string) {
  tabelasLidas.push(tabela)
  const q: Record<string, unknown> = {}
  const encadeia = () => q
  for (const m of ['eq', 'neq', 'ilike', 'in', 'is', 'not', 'or', 'gte', 'lte', 'gt', 'lt', 'order', 'range', 'limit', 'filter', 'match', 'textSearch']) {
    q[m] = encadeia
  }
  q.select = (colunas: string) => { selects.push(colunas); return q }
  q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
    Promise.resolve({ data: tabela === 'processos_recebimento' ? linhasDoBanco : [], error: null, count: linhasDoBanco.length }).then(ok, erro)
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from: consulta }),
}))

const { listarProcessosGrid } = await import('../processo-repository')

describe('listarProcessosGrid: autor da justificativa', () => {
  beforeEach(() => { tabelasLidas.length = 0; selects.length = 0; linhasDoBanco = [] })

  // Três asserções separadas de propósito: num `it` só, a primeira a falhar esconde as outras —
  // e a terceira (a negativa) é justamente a que prova o ponto desta mudança.
  async function listar() {
    linhasDoBanco = [{
      id: 'p1',
      divergencia_justificada_por: 'u1',
      divergencia_justificada_por_nome: 'Maria Souza',
    }]
    return listarProcessosGrid({
      estado: { pagina: 0, tamanho: 20, ordenar: 'numero', filtros: {} } as never,
      colunas: ['numero_emb'],
      tiposPorCampo: {},
    })
  }

  it('pede a coluna do nome no select', async () => {
    await listar()
    expect(selects[0]).toContain('divergencia_justificada_por_nome')
  })

  it('não pede o uuid do autor (nenhuma tela usa; o nome vem denormalizado)', async () => {
    await listar()
    expect(selects[0]).not.toMatch(/divergencia_justificada_por(?!_nome)/)
  })

  it('devolve o nome que veio na própria linha', async () => {
    const r = await listar()
    expect(r.linhas[0]?.divergencia_justificada_por_nome).toBe('Maria Souza')
  })

  it('não consulta a tabela usuarios para resolver o nome', async () => {
    await listar()
    expect(tabelasLidas).toContain('processos_recebimento') // a consulta aconteceu de fato
    expect(tabelasLidas).not.toContain('usuarios')
  })
})
