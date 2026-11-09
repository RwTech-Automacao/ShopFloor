// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient }))

import { middleware } from '../../../../../middleware'

type AppUser = { ativo: boolean; perfil_id: string | null; senha_provisoria: boolean }
let user: { id: string } | null = null
let appUser: AppUser | null = null

beforeEach(() => {
  user = null
  appUser = null
  createServerClient.mockReset()
  createServerClient.mockImplementation(() => ({
    auth: { getUser: async () => ({ data: { user } }), signOut: async () => {} },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: appUser }) }) }) }),
  }))
})

const BASE = 'https://shopfloor.enterplak.com.br'
const pedido = (caminho: string, method = 'GET') => new NextRequest(`${BASE}${caminho}`, { method })
/** Location resolvido contra o site — o teste olha só caminho + query. */
function destino(res: Response) {
  const u = new URL(res.headers.get('location')!, BASE)
  return { pathname: u.pathname, next: u.searchParams.get('next'), search: u.search }
}

describe('middleware: sem sessão, o /login leva o link aberto em ?next=', () => {
  it('link de alerta (caminho) vai pro /login com o destino', async () => {
    const res = await middleware(pedido('/recebimento/emb/EMB388CA'))
    expect(res.status).toBe(307)
    expect(destino(res)).toMatchObject({ pathname: '/login', next: '/recebimento/emb/EMB388CA' })
  })

  it('a query do link vai junto, dentro do next (e não solta na URL do /login)', async () => {
    const res = await middleware(pedido('/shopfloor/analisar/parados?regra=abc&dias=7'))
    const d = destino(res)
    expect(d.pathname).toBe('/login')
    expect(d.next).toBe('/shopfloor/analisar/parados?regra=abc&dias=7')
    expect(new URLSearchParams(d.search).get('regra')).toBeNull()
  })

  it('/home e / não ganham next (o login já cai no /home)', async () => {
    for (const p of ['/home', '/']) {
      const res = await middleware(pedido(p))
      expect(destino(res), p).toMatchObject({ pathname: '/login', search: '' })
    }
  })

  it('/api/* e POST não viram destino', async () => {
    for (const res of [
      await middleware(pedido('/api/qualquer?x=1')),
      await middleware(pedido('/shopfloor/fluxo', 'POST')),
    ]) {
      expect(destino(res)).toMatchObject({ pathname: '/login', search: '' })
    }
  })

  it('/login sem sessão continua abrindo (sem laço de redirect)', async () => {
    const res = await middleware(pedido('/login?next=%2Fshopfloor%2Ffluxo'))
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('middleware: já logado no /login segue pro destino validado', () => {
  beforeEach(() => {
    user = { id: 'u1' }
    appUser = { ativo: true, perfil_id: 'p1', senha_provisoria: false }
  })

  it('next interno: vai pra ele, com a query', async () => {
    const res = await middleware(pedido('/login?next=' + encodeURIComponent('/shopfloor/analisar/parados?regra=abc')))
    expect(res.status).toBe(307)
    const u = new URL(res.headers.get('location')!, BASE)
    expect(u.pathname + u.search).toBe('/shopfloor/analisar/parados?regra=abc')
    expect(u.host).toBe('shopfloor.enterplak.com.br')
  })

  it('next externo ou malicioso: /home', async () => {
    for (const n of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/login']) {
      const res = await middleware(pedido('/login?next=' + encodeURIComponent(n)))
      const u = new URL(res.headers.get('location')!, BASE)
      expect(u.host, n).toBe('shopfloor.enterplak.com.br')
      expect(u.pathname + u.search, n).toBe('/home')
    }
  })
})
