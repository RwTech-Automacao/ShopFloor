// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { updateSession } = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}))
vi.mock('@/shared/lib/supabase/middleware', () => ({ updateSession }))

import { middleware } from '../../../../../middleware'

const pedido = (caminho: string) => new NextRequest(`https://shopfloor.enterplak.com.br${caminho}`)

beforeEach(() => vi.clearAllMocks())

/** O navegador busca o manifesto sem o cookie: indo pra sessão, viria o /login no lugar do JSON e o app não instala. */
describe('middleware × manifesto do app Baixa de NF', () => {
  it('GET /faturamento/manifest.webmanifest não passa pela sessão', async () => {
    const res = await middleware(pedido('/faturamento/manifest.webmanifest'))
    expect(updateSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })

  it('a tela e qualquer outro caminho do Faturamento continuam exigindo sessão', async () => {
    await middleware(pedido('/faturamento/baixa-nf'))
    await middleware(pedido('/faturamento/manifest.webmanifest/x'))
    await middleware(pedido('/faturamento/manifest.webmanifestx'))
    expect(updateSession).toHaveBeenCalledTimes(3)
  })
})
