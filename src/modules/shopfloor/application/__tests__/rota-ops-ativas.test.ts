// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Supabase de mentira com service role: `sf_ordens` e `sf_registros` respeitam o `.range()` e
 * cortam em 1000 linhas por consulta, como o PostgREST (max_rows). `sf_registros` também respeita
 * o `.gte('data_hora', corte)` e a ordenação decrescente que a rota pede.
 */
const MAX_ROWS = 1000
let ordens: Record<string, unknown>[] = []
let registros: Record<string, unknown>[] = []
let erro: unknown = null
let consultas: { tabela: string; gte: [string, string][]; range: [number, number] | null }[] = []
let criouCliente = 0

function consulta(tabela: string) {
  const gte: [string, string][] = []
  let ordem: { coluna: string; asc: boolean }[] = []
  let de = 0
  let ate = Number.POSITIVE_INFINITY
  const q = {
    select: () => q,
    eq: () => q,
    not: () => q,
    neq: () => q,
    gte(coluna: string, valor: string) {
      gte.push([coluna, valor])
      return q
    },
    order(coluna: string, opcoes?: { ascending?: boolean }) {
      ordem = [...ordem, { coluna, asc: opcoes?.ascending !== false }]
      return q
    },
    range(a: number, b: number) {
      de = a
      ate = b
      return q
    },
    then(ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) {
      consultas.push({ tabela, gte, range: [de, ate] })
      if (erro) return Promise.resolve({ data: null, error: erro }).then(ok, falhou)
      let fonte = tabela === 'sf_ordens' ? [...ordens] : [...registros]
      for (const [coluna, valor] of gte) {
        fonte = fonte.filter((r) => String(r[coluna]) >= valor)
      }
      for (const o of [...ordem].reverse()) {
        fonte.sort((a, b) => {
          const x = String(a[o.coluna] ?? '')
          const y = String(b[o.coluna] ?? '')
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1)
        })
      }
      const fim = Math.min(ate + 1, de + MAX_ROWS)
      return Promise.resolve({ data: fonte.slice(de, fim), error: null }).then(ok, falhou)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/service', () => ({
  createServiceSupabase: () => {
    criouCliente += 1
    return { from: consulta }
  },
}))

const { GET } = await import('@/app/api/dashboard/ops-ativas/route')

const SEGREDO = 'segredo-do-dashboard'

function pedido(query = '', cabecalhos: Record<string, string> = { authorization: `Bearer ${SEGREDO}` }) {
  return new Request(`https://shopfloor.enterplak.com.br/api/dashboard/ops-ativas${query}`, {
    headers: cabecalhos,
  })
}

const ordem = (pmo: string, op: string, status = 'ABERTA') => ({
  pmo,
  op,
  cliente: 'VMI',
  descricao: 'PLACA MONTADA INDICADOR LED CERTIFICADO',
  status,
})
const bipe = (pmo: string, op: string, data_hora: string, id = `${pmo}-${op}-${data_hora}`) => ({
  pmo,
  op,
  data_hora,
  id,
})

beforeEach(() => {
  ordens = []
  registros = []
  erro = null
  consultas = []
  criouCliente = 0
  vi.useRealTimers()
  vi.stubEnv('DASHBOARD_API_SECRET', SEGREDO)
})

describe('GET /api/dashboard/ops-ativas — autenticação', () => {
  it('sem cabeçalho de autorização devolve 401 e não toca no banco', async () => {
    const res = await GET(pedido('', {}))
    expect(res.status).toBe(401)
    expect(criouCliente).toBe(0)
  })

  it('segredo errado devolve 401', async () => {
    const res = await GET(pedido('', { authorization: 'Bearer outro-segredo' }))
    expect(res.status).toBe(401)
    expect(criouCliente).toBe(0)
  })

  it('segredo certo sem o prefixo Bearer devolve 401', async () => {
    const res = await GET(pedido('', { authorization: SEGREDO }))
    expect(res.status).toBe(401)
    expect(criouCliente).toBe(0)
  })

  it('401 não devolve o segredo esperado', async () => {
    const res = await GET(pedido('', { authorization: 'Bearer outro-segredo' }))
    expect(JSON.stringify(await res.json())).not.toContain(SEGREDO)
  })

  it('autorização errada devolve 401, nunca um redirect', async () => {
    const res = await GET(pedido('?dias=30', {}))
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })

  it('sem segredo configurado no ambiente devolve 503 (e não 200 sem autenticação)', async () => {
    vi.stubEnv('DASHBOARD_API_SECRET', '')
    const res = await GET(pedido('', { authorization: 'Bearer ' }))
    expect(res.status).toBe(503)
    expect(criouCliente).toBe(0)
  })
})

describe('GET /api/dashboard/ops-ativas — o parâmetro dias', () => {
  it('fora da faixa devolve 400 e não consulta o banco', async () => {
    for (const q of ['?dias=0', '?dias=366', '?dias=abc', '?dias=1.5', '?dias=-5']) {
      const res = await GET(pedido(q))
      expect(res.status, q).toBe(400)
    }
    expect(criouCliente).toBe(0)
  })

  it('a fronteira de dentro (1 e 365) é aceita', async () => {
    for (const q of ['?dias=1', '?dias=365']) {
      const res = await GET(pedido(q))
      expect(res.status, q).toBe(200)
    }
  })

  it('com dias, o corte é agora menos os dias e vai no gte do data_hora', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
    await GET(pedido('?dias=30'))
    const dosRegistros = consultas.filter((c) => c.tabela === 'sf_registros')
    expect(dosRegistros.length).toBeGreaterThan(0)
    for (const c of dosRegistros) {
      expect(c.gte).toEqual([['data_hora', '2026-09-06T12:00:00.000Z']])
    }
  })

  it('sem dias não há recorte de data nenhum', async () => {
    await GET(pedido())
    for (const c of consultas) expect(c.gte).toEqual([])
  })
})

describe('GET /api/dashboard/ops-ativas — a lista', () => {
  it('devolve geradoEm e as OPs no formato da spec', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
    ordens = [ordem('PMOC13', '2340/26')]
    registros = [bipe('PMOC13', '2340/26', '2026-10-06T11:42:10+00:00')]
    const res = await GET(pedido('?dias=30'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      geradoEm: '2026-10-06T12:00:00.000Z',
      ops: [
        {
          pmo: 'PMOC13',
          op: '2340/26',
          cliente: 'VMI',
          descricao: 'PLACA MONTADA INDICADOR LED CERTIFICADO',
          ultimoBipe: '2026-10-06T11:42:10.000Z',
        },
      ],
    })
  })

  it('nunca pode ser servida de cache', async () => {
    const res = await GET(pedido())
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('a OP FINALIZADA fica fora, em qualquer caixa', async () => {
    ordens = [
      ordem('PMOC13', '2340/26'),
      ordem('PMOX', '1', 'FINALIZADA'),
      ordem('PMOY', '2', 'finalizada'),
      ordem('PMOZ', '3', ' Finalizada '),
    ]
    registros = [
      bipe('PMOC13', '2340/26', '2026-10-06T11:00:00+00:00'),
      bipe('PMOX', '1', '2026-10-06T11:30:00+00:00'),
      bipe('PMOY', '2', '2026-10-06T11:40:00+00:00'),
      bipe('PMOZ', '3', '2026-10-06T11:50:00+00:00'),
    ]
    const { ops } = (await (await GET(pedido())).json()) as { ops: { pmo: string }[] }
    expect(ops.map((o) => o.pmo)).toEqual(['PMOC13'])
  })

  it('sem dias, vêm todas as não finalizadas — inclusive a que nunca teve bipe', async () => {
    ordens = [ordem('PMOC13', '2340/26'), ordem('PMOZ', '9')]
    registros = [bipe('PMOC13', '2340/26', '2026-10-06T11:00:00+00:00')]
    const { ops } = (await (await GET(pedido())).json()) as { ops: { pmo: string; ultimoBipe: string | null }[] }
    expect(ops.map((o) => o.pmo)).toEqual(['PMOC13', 'PMOZ'])
    expect(ops[1]?.ultimoBipe).toBeNull()
  })

  it('com dias, a OP sem bipe no recorte sai da lista', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
    ordens = [ordem('PMOC13', '2340/26'), ordem('PMOVELHA', '1'), ordem('PMOSEMBIPE', '2')]
    registros = [
      bipe('PMOC13', '2340/26', '2026-10-06T11:00:00+00:00'),
      bipe('PMOVELHA', '1', '2026-07-01T10:00:00+00:00'),
    ]
    const { ops } = (await (await GET(pedido('?dias=30'))).json()) as { ops: { pmo: string }[] }
    expect(ops.map((o) => o.pmo)).toEqual(['PMOC13'])
  })

  it('ordena por ultimoBipe decrescente, com as OPs sem bipe POR ÚLTIMO', async () => {
    ordens = [
      ordem('SEMBIPE', '1'),
      ordem('ANTIGA', '2'),
      ordem('RECENTE', '3'),
      ordem('MEIO', '4'),
    ]
    registros = [
      bipe('ANTIGA', '2', '2026-09-01T10:00:00+00:00'),
      bipe('RECENTE', '3', '2026-10-06T11:42:10+00:00'),
      bipe('MEIO', '4', '2026-10-01T08:00:00+00:00'),
    ]
    const { ops } = (await (await GET(pedido())).json()) as { ops: { pmo: string; ultimoBipe: string | null }[] }
    expect(ops.map((o) => o.pmo)).toEqual(['RECENTE', 'MEIO', 'ANTIGA', 'SEMBIPE'])
    expect(ops.at(-1)?.ultimoBipe).toBeNull()
  })

  it('o ultimoBipe é o bipe MAIS RECENTE da OP, não o primeiro que aparecer', async () => {
    ordens = [ordem('PMOC13', '2340/26')]
    registros = [
      bipe('PMOC13', '2340/26', '2026-10-01T08:00:00+00:00'),
      bipe('PMOC13', '2340/26', '2026-10-06T11:42:10+00:00'),
      bipe('PMOC13', '2340/26', '2026-10-03T09:00:00+00:00'),
    ]
    const { ops } = (await (await GET(pedido())).json()) as { ops: { ultimoBipe: string }[] }
    expect(ops[0]?.ultimoBipe).toBe('2026-10-06T11:42:10.000Z')
  })

  it('pagina as duas tabelas: mais de 1000 OPs e mais de 1000 bipes no recorte', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'))
    for (let i = 0; i < 1200; i++) {
      const op = String(10000 + i)
      ordens.push(ordem('PMOC13', op))
      registros.push(bipe('PMOC13', op, `2026-10-0${(i % 5) + 1}T10:00:00+00:00`, op))
    }
    const { ops } = (await (await GET(pedido('?dias=30'))).json()) as { ops: unknown[] }
    expect(ops.length).toBe(1200)
  })

  it('banco indisponível devolve 503 em vez de estourar', async () => {
    erro = { message: 'connection refused' }
    const res = await GET(pedido())
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
