// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { updateSession } = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}))
vi.mock('@/shared/lib/supabase/middleware', () => ({ updateSession }))

import { middleware } from '../../../../../middleware'

function pedido(caminho: string) {
  return new NextRequest(`https://shopfloor.enterplak.com.br${caminho}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

/** O tablet do Almoxarifado não tem login: sem a saída no middleware ele cairia no /login. */
describe('middleware × página do tablet do Almoxarifado', () => {
  it('não manda GET /quiosque/fichas?k=… para a sessão (nem para o /login)', async () => {
    const res = await middleware(pedido('/quiosque/fichas?k=qualquer'))
    expect(updateSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })

  it('outro caminho sob /quiosque continua exigindo sessão', async () => {
    await middleware(pedido('/quiosque/fichas/x'))
    await middleware(pedido('/quiosque/outra'))
    expect(updateSession).toHaveBeenCalledTimes(2)
  })
})
