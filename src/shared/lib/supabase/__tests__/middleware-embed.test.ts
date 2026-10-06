// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CABECALHO_EMBED, COOKIE_EMBED } from '../embed'

// vi.mock é içado para o topo do arquivo: o espião precisa nascer num vi.hoisted.
const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient }))

import { middleware } from '../../../../../middleware'

type AppUser = { ativo: boolean; perfil_id: string | null; senha_provisoria: boolean }
type OpcoesSsr = {
  cookieOptions?: { name: string; path: string }
  cookies: { getAll: () => unknown; setAll: (c: { name: string; value: string; options?: unknown }[]) => void }
}

let user: { id: string } | null = null
let appUser: AppUser | null = null
let opcoes: OpcoesSsr | undefined
/** Cookies que o Supabase "renova" durante o getUser (refresh de sessão). */
let renovar: { name: string; value: string; options?: unknown }[] = []

const VALIDO: AppUser = { ativo: true, perfil_id: 'p1', senha_provisoria: false }
const PROVISORIA: AppUser = { ativo: true, perfil_id: 'p1', senha_provisoria: true }

beforeEach(() => {
  user = null
  appUser = null
  opcoes = undefined
  renovar = []
  createServerClient.mockReset()
  createServerClient.mockImplementation((_url: string, _chave: string, recebidas: OpcoesSsr) => {
    opcoes = recebidas
    return {
      auth: {
        getUser: async () => {
          if (renovar.length) recebidas.cookies.setAll(renovar)
          return { data: { user } }
        },
        signOut: async () => {},
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: appUser }) }) }),
      }),
    }
  })
})

function pedido(pathname: string, cabecalhos: Record<string, string> = {}) {
  return new NextRequest(`https://shopfloor.enterplak.com.br${pathname}`, { headers: cabecalhos })
}
/** A marca que o Next vai entregar ao servidor (override dos cabeçalhos da requisição). */
const marcaPropagada = (res: Response) => res.headers.get(`x-middleware-request-${CABECALHO_EMBED}`)

describe('middleware: a marca de embed é decidida pelo caminho', () => {
  it('em /embed/* injeta a marca', async () => {
    const res = await middleware(pedido('/embed/fluxo/PMOC13/2340%2F26'))
    expect(marcaPropagada(res)).toBe('1')
  })

  // Se a marca viesse do cliente, quem tivesse o cookie da conta compartilhada navegaria o app
  // inteiro como ela. Em rota normal ela é SEMPRE apagada.
  it('APAGA a marca mandada pelo cliente em rota normal', async () => {
    user = { id: 'u1' }
    appUser = VALIDO
    for (const p of ['/home', '/embedx', '/shopfloor/fluxo']) {
      const res = await middleware(pedido(p, { [CABECALHO_EMBED]: '1' }))
      expect(marcaPropagada(res), p).toBeNull()
      expect(res.headers.get('x-middleware-override-headers') ?? '', p).not.toContain(CABECALHO_EMBED)
    }
  })

  it('APAGA a marca mandada pelo cliente na rota pública dos alertas', async () => {
    const res = await middleware(pedido('/api/alertas/telegram', { [CABECALHO_EMBED]: '1' }))
    expect(marcaPropagada(res)).toBeNull()
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('a marca sobrevive à renovação de cookies, e o cookie novo também', async () => {
    renovar = [{ name: 'sf-embed-auth', value: 'novo', options: { path: '/embed' } }]
    const res = await middleware(pedido('/embed/fluxo/PMOC13/2340', { cookie: 'antigo=1' }))
    expect(marcaPropagada(res)).toBe('1')
    expect(res.headers.get('x-middleware-request-cookie')).toContain('sf-embed-auth=novo')
  })

  it('na renovação em rota normal a marca do cliente continua apagada', async () => {
    user = { id: 'u1' }
    appUser = VALIDO
    renovar = [{ name: 'sb-auth', value: 'novo', options: { path: '/' } }]
    const res = await middleware(pedido('/home', { [CABECALHO_EMBED]: '1', cookie: 'antigo=1' }))
    expect(marcaPropagada(res)).toBeNull()
    expect(res.headers.get('x-middleware-request-cookie')).toContain('sb-auth=novo')
  })
})

describe('middleware: qual cookie de sessão o cliente usa', () => {
  it('em /embed/* é o cookie próprio, com Path=/embed', async () => {
    await middleware(pedido('/embed/fluxo/PMOC13/2340'))
    expect(opcoes?.cookieOptions).toEqual({ name: COOKIE_EMBED, path: '/embed' })
  })

  it('em rota normal é o cookie de sempre (nenhuma opção)', async () => {
    user = { id: 'u1' }
    appUser = VALIDO
    for (const p of ['/home', '/embedx']) {
      await middleware(pedido(p))
      expect(opcoes?.cookieOptions, p).toBeUndefined()
    }
  })
})

describe('middleware: redirecionamentos', () => {
  it('rota normal sem sessão vai pro /login', async () => {
    const res = await middleware(pedido('/home'))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  it('rota normal com senha provisória vai pro /definir-senha', async () => {
    user = { id: 'u1' }
    appUser = PROVISORIA
    const res = await middleware(pedido('/home'))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/definir-senha')
  })

  it('/embed/* sem sessão NÃO vai pro /login: a tela avisa o pai', async () => {
    for (const p of ['/embed', '/embed/', '/embed/sso', '/embed/fluxo/PMOC13/2340']) {
      const res = await middleware(pedido(p))
      expect(res.status, p).toBe(200)
      expect(res.headers.get('location'), p).toBeNull()
    }
  })

  it('/embed/* com senha provisória NÃO vai pro /definir-senha', async () => {
    user = { id: 'u1' }
    appUser = PROVISORIA
    const res = await middleware(pedido('/embed/fluxo/PMOC13/2340'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('/embed/* com sessão válida segue adiante', async () => {
    user = { id: 'u1' }
    appUser = VALIDO
    const res = await middleware(pedido('/embed/fluxo/PMOC13/2340'))
    expect(res.status).toBe(200)
  })

  it('o /login ainda manda quem já está logado pro /home', async () => {
    user = { id: 'u1' }
    appUser = VALIDO
    const res = await middleware(pedido('/login'))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/home')
  })
})
