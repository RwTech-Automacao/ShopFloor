// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { updateSession } = vi.hoisted(() => ({
  updateSession: vi.fn(async () => NextResponse.next()),
}))
vi.mock('@/shared/lib/supabase/middleware', () => ({ updateSession }))

import { middleware } from '../../../../../middleware'

function pedido(caminho: string) {
  return new NextRequest(`https://shopfloor.enterplak.com.br${caminho}`, { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * A rota do cron não tem sessão nenhuma — quem autoriza é o segredo, dentro dela. Sem a saída no
 * middleware ela levaria um redirect pro /login, e o `curl -fsS` do crontab trataria o 3xx como
 * sucesso: a fila nunca sairia e o log diria que tudo correu bem. Daí este teste.
 */
describe('middleware × rota do cron de estoque', () => {
  it('não manda POST /api/shopfloor/estoque para a sessão (nem para o /login)', async () => {
    const res = await middleware(pedido('/api/shopfloor/estoque'))
    expect(updateSession).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('barra final não tira a rota da saída: /api/shopfloor/estoque/ também não vai pro /login', async () => {
    const res = await middleware(pedido('/api/shopfloor/estoque/'))
    expect(updateSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })

  it('caminho que só começa com o mesmo prefixo NÃO ganha a saída (exige sessão)', async () => {
    await middleware(pedido('/api/shopfloor/estoque-outra'))
    await middleware(pedido('/api/shopfloor/estoque/outra'))
    expect(updateSession).toHaveBeenCalledTimes(2)
  })

  it('e continua exigindo sessão no resto do ShopFloor (a saída é só desta rota)', async () => {
    await middleware(pedido('/shopfloor/operar/lancamento'))
    expect(updateSession).toHaveBeenCalledTimes(1)
  })
})
