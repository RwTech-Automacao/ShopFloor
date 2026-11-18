// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { updateSession } = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}))
vi.mock('@/shared/lib/supabase/middleware', () => ({ updateSession }))

import { middleware } from '../../../../../middleware'

const pedido = (caminho: string) => new NextRequest(`https://shopfloor.enterplak.com.br${caminho}`, { method: 'POST' })

beforeEach(() => vi.clearAllMocks())

/** Sem a saída, o cron levaria redirect pro /login e o `curl -f` trataria o 3xx como sucesso (falha silenciosa). */
describe('middleware × espelho das OPs do Compels', () => {
  it('POST /api/compels/espelho-ops não passa pela sessão', async () => {
    const res = await middleware(pedido('/api/compels/espelho-ops'))
    expect(updateSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })

  it('caminhos parecidos continuam exigindo sessão', async () => {
    await middleware(pedido('/api/compels/espelho-ops/x'))
    await middleware(pedido('/api/compels/espelho-opsx'))
    await middleware(pedido('/shopfloor/ordens/nova'))
    expect(updateSession).toHaveBeenCalledTimes(3)
  })
})
