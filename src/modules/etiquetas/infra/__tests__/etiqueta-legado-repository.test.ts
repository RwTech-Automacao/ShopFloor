import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * As LEITURAS da tabela `etiquetas_legado`, com um Supabase de mentira que de fato aplica os
 * filtros pedidos e corta em 1.000 linhas como o PostgREST (`max_rows`).
 *
 * Por que testar a infra, se a tela é testada com o repositório mockado: a regra mais perigosa
 * desta feature — PENDENTE É `impressa_em is null` **E** `removida_em is null` — mora aqui e em
 * nenhum outro lugar. Remover não apaga a linha (é ela que guarda o sequencial), então sem o
 * segundo filtro o que o almoxarife removeu volta para a lista e entra no CSV. Com o repositório
 * mockado, apagar esse filtro não quebra teste nenhum.
 */

const MAX_ROWS = 1000

interface Filtro {
  metodo: string
  coluna: string
  valor: unknown
}

interface Consulta {
  tabela: string
  colunas: string
  contagem?: string
  filtros: Filtro[]
  ordem: { coluna: string; ascendente: boolean }[]
  limite?: number
}

let tabela: Record<string, unknown>[] = []
let consultas: Consulta[] = []

function instante(v: unknown): number {
  return new Date(String(v)).getTime()
}

function passa(linha: Record<string, unknown>, f: Filtro): boolean {
  const valor = linha[f.coluna]
  switch (f.metodo) {
    case 'is':
      return valor === null || valor === undefined
    case 'not.is':
      return valor !== null && valor !== undefined
    case 'eq':
      return valor === f.valor
    case 'in':
      return (f.valor as unknown[]).includes(valor)
    case 'gte':
      return instante(valor) >= instante(f.valor)
    case 'lte':
      return instante(valor) <= instante(f.valor)
    default:
      throw new Error(`filtro não simulado: ${f.metodo}`)
  }
}

function construtor(nome: string) {
  const c: Consulta = { tabela: nome, colunas: '', filtros: [], ordem: [] }
  consultas.push(c)

  const q = {
    select(colunas: string, opcoes?: { count?: string }) {
      c.colunas = colunas
      if (opcoes?.count) c.contagem = opcoes.count
      return q
    },
    is(coluna: string, valor: unknown) {
      c.filtros.push({ metodo: 'is', coluna, valor })
      return q
    },
    not(coluna: string, operador: string, valor: unknown) {
      c.filtros.push({ metodo: `not.${operador}`, coluna, valor })
      return q
    },
    eq(coluna: string, valor: unknown) {
      c.filtros.push({ metodo: 'eq', coluna, valor })
      return q
    },
    in(coluna: string, valor: unknown[]) {
      c.filtros.push({ metodo: 'in', coluna, valor })
      return q
    },
    gte(coluna: string, valor: unknown) {
      c.filtros.push({ metodo: 'gte', coluna, valor })
      return q
    },
    lte(coluna: string, valor: unknown) {
      c.filtros.push({ metodo: 'lte', coluna, valor })
      return q
    },
    order(coluna: string, opcoes?: { ascending?: boolean }) {
      c.ordem.push({ coluna, ascendente: opcoes?.ascending !== false })
      return q
    },
    limit(n: number) {
      c.limite = n
      return q
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      let linhas = tabela.filter((l) => c.filtros.every((f) => passa(l, f)))
      for (const o of [...c.ordem].reverse()) {
        linhas = [...linhas].sort((a, b) => {
          const x = String(a[o.coluna] ?? '')
          const y = String(b[o.coluna] ?? '')
          return o.ascendente ? x.localeCompare(y) : y.localeCompare(x)
        })
      }
      // `count: 'exact'` conta ANTES do limite — é essa contagem que diz se sobrou algo de fora.
      const count = c.contagem ? linhas.length : null
      // O teto do PostgREST vale mesmo quando se pede mais: pedir 1.001 devolve 1.000.
      const data = linhas.slice(0, Math.min(c.limite ?? MAX_ROWS, MAX_ROWS))
      return Promise.resolve({ data, count, error: null }).then(ok, erro)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from: construtor }),
}))

const {
  buscarPendentePorCodigoLegado,
  listarImpressasLegado,
  listarImpressasPorIdsLegado,
  listarPendentesLegado,
} = await import('../etiqueta-legado-repository')

function linha(sobrescrever: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a',
    item: 'CAPA78',
    pedido: '123425',
    sequencial: 4,
    codigo: 'CAPA78-123425L0004',
    usuario_nome: 'Ana',
    created_at: '2026-09-30T10:00:00Z',
    impressa_em: null,
    removida_em: null,
    ...sobrescrever,
  }
}

function filtros(indice = 0): string[] {
  const c = consultas[indice]!
  return c.filtros.map((f) => `${f.metodo}:${f.coluna}`)
}

beforeEach(() => {
  tabela = []
  consultas = []
})

describe('listarPendentesLegado', () => {
  it('a etiqueta REMOVIDA fica fora da lista — o número dela já está queimado', async () => {
    tabela = [
      linha({ id: 'viva', codigo: 'CAPA78-L0001' }),
      linha({ id: 'removida', codigo: 'CAPA78-L0002', removida_em: '2026-09-30T11:00:00Z' }),
    ]

    const { linhas } = await listarPendentesLegado()

    expect(linhas.map((l) => l.id)).toEqual(['viva'])
    expect(filtros()).toContain('is:removida_em')
  })

  it('a etiqueta JÁ IMPRESSA fica fora da lista — ela não espera mais nada', async () => {
    tabela = [
      linha({ id: 'viva' }),
      linha({ id: 'impressa', impressa_em: '2026-09-30T11:00:00Z' }),
    ]

    const { linhas } = await listarPendentesLegado()

    expect(linhas.map((l) => l.id)).toEqual(['viva'])
    expect(filtros()).toContain('is:impressa_em')
  })

  it('mais nova em cima', async () => {
    tabela = [
      linha({ id: 'velha', created_at: '2026-09-29T08:00:00Z' }),
      linha({ id: 'nova', created_at: '2026-09-30T18:00:00Z' }),
    ]

    const { linhas } = await listarPendentesLegado()

    expect(linhas.map((l) => l.id)).toEqual(['nova', 'velha'])
    expect(consultas[0]!.ordem).toEqual([{ coluna: 'created_at', ascendente: false }])
  })

  it('com mais pendentes do que o teto, avisa que a lista está cortada', async () => {
    // 1.500 pendentes: o PostgREST devolve 1.000 e é o `count` que sabe dos outros 500. Pedir uma
    // linha além do teto (1.001) não descobriria nada — o corte é do PostgREST, não do `limit`.
    tabela = Array.from({ length: 1500 }, (_, i) =>
      linha({ id: `r${i}`, codigo: `CAPA78-L${i}`, created_at: `2026-09-30T10:00:${String(i % 60).padStart(2, '0')}Z` }),
    )

    const { linhas, cortada } = await listarPendentesLegado()

    expect(linhas).toHaveLength(1000)
    expect(cortada).toBe(true)
    expect(consultas[0]!.contagem).toBe('exact')
  })

  it('com exatamente o teto de pendentes, NÃO avisa corte — não há nada de fora', async () => {
    tabela = Array.from({ length: 1000 }, (_, i) => linha({ id: `r${i}`, codigo: `CAPA78-L${i}` }))

    const { linhas, cortada } = await listarPendentesLegado()

    expect(linhas).toHaveLength(1000)
    expect(cortada).toBe(false)
  })
})

describe('listarImpressasLegado', () => {
  it('traz só as IMPRESSAS, e a removida nunca aparece', async () => {
    tabela = [
      linha({ id: 'impressa', impressa_em: '2026-09-30T12:00:00Z' }),
      linha({ id: 'pendente' }),
      linha({ id: 'removida-impressa', impressa_em: '2026-09-30T12:00:00Z', removida_em: '2026-09-30T13:00:00Z' }),
    ]

    const linhas = await listarImpressasLegado('2026-09-30', '2026-09-30')

    expect(linhas.map((l) => l.id)).toEqual(['impressa'])
    expect(filtros()).toEqual(
      expect.arrayContaining(['not.is:impressa_em', 'is:removida_em', 'gte:impressa_em', 'lte:impressa_em']),
    )
  })

  it('o dia final inteiro entra, em Brasília — o que foi impresso às 22h não some', async () => {
    tabela = [linha({ id: 'noite', impressa_em: '2026-09-30T22:30:00-03:00' })]

    const linhas = await listarImpressasLegado('2026-09-29', '2026-09-30')

    expect(linhas.map((l) => l.id)).toEqual(['noite'])
  })

  it('mais nova em cima, pela data de impressão', async () => {
    tabela = [
      linha({ id: 'antes', impressa_em: '2026-09-30T09:00:00Z' }),
      linha({ id: 'depois', impressa_em: '2026-09-30T17:00:00Z' }),
    ]

    const linhas = await listarImpressasLegado('2026-09-30', '2026-09-30')

    expect(linhas.map((l) => l.id)).toEqual(['depois', 'antes'])
  })
})

describe('listarImpressasPorIdsLegado', () => {
  it('só os ids pedidos, e só se estiverem impressos e não removidos', async () => {
    tabela = [
      linha({ id: 'x', impressa_em: '2026-09-30T12:00:00Z' }),
      linha({ id: 'y', impressa_em: '2026-09-30T12:00:00Z', removida_em: '2026-09-30T13:00:00Z' }),
      linha({ id: 'z' }),
      linha({ id: 'fora', impressa_em: '2026-09-30T12:00:00Z' }),
    ]

    const linhas = await listarImpressasPorIdsLegado(['x', 'y', 'z'])

    expect(linhas.map((l) => l.id)).toEqual(['x'])
    expect(filtros()).toEqual(expect.arrayContaining(['in:id', 'not.is:impressa_em', 'is:removida_em']))
  })

  it('lista vazia não consulta o banco', async () => {
    expect(await listarImpressasPorIdsLegado([])).toEqual([])
    expect(consultas).toHaveLength(0)
  })

  it('acima do teto do PostgREST, recusa em vez de devolver a 2ª via curta em silêncio', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `id${i}`)

    await expect(listarImpressasPorIdsLegado(ids)).rejects.toThrow(/levas menores/)
    expect(consultas).toHaveLength(0)
  })
})

describe('buscarPendentePorCodigoLegado', () => {
  it('acha a linha recém-emitida pelo código, com o id que a tela usa para remover', async () => {
    tabela = [linha({ id: 'nova', codigo: 'CAPA78-123425L0004' })]

    const r = await buscarPendentePorCodigoLegado('CAPA78-123425L0004')

    expect(r?.id).toBe('nova')
    expect(filtros()).toEqual(expect.arrayContaining(['eq:codigo', 'is:impressa_em', 'is:removida_em']))
  })

  it('não devolve uma linha removida com esse código', async () => {
    tabela = [linha({ id: 'nova', codigo: 'CAPA78-123425L0004', removida_em: '2026-09-30T11:00:00Z' })]

    expect(await buscarPendentePorCodigoLegado('CAPA78-123425L0004')).toBeNull()
  })

  it('não devolve uma linha já impressa com esse código', async () => {
    tabela = [linha({ id: 'nova', codigo: 'CAPA78-123425L0004', impressa_em: '2026-09-30T11:00:00Z' })]

    expect(await buscarPendentePorCodigoLegado('CAPA78-123425L0004')).toBeNull()
  })
})
