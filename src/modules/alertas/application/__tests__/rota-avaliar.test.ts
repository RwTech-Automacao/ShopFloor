// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { criarDependenciasAlertas, avaliarEEnviar } = vi.hoisted(() => ({
  criarDependenciasAlertas: vi.fn(() => ({ portas: {}, repo: {} })),
  avaliarEEnviar: vi.fn(async () => ({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })),
}))
vi.mock('@/modules/alertas/infra/fabrica', () => ({ criarDependenciasAlertas }))
vi.mock('@/modules/alertas/application/enviar-alertas', () => ({ avaliarEEnviar }))

import { POST } from '@/app/api/alertas/avaliar/route'

function pedido(cabecalhos: Record<string, string> = {}) {
  return new Request('https://shopfloor.enterplak.com.br/api/alertas/avaliar', {
    method: 'POST',
    headers: cabecalhos,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  avaliarEEnviar.mockResolvedValue({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
  vi.stubEnv('ALERTAS_CRON_SECRET', 'segredo-do-cron')
})

describe('POST /api/alertas/avaliar', () => {
  it('sem cabeçalho de autorização devolve 401 e não avalia', async () => {
    const res = await POST(pedido())
    expect(res.status).toBe(401)
    expect(avaliarEEnviar).not.toHaveBeenCalled()
  })

  it('segredo errado devolve 401', async () => {
    const res = await POST(pedido({ authorization: 'Bearer outro' }))
    expect(res.status).toBe(401)
  })

  it('segredo certo sem o prefixo Bearer devolve 401', async () => {
    const res = await POST(pedido({ authorization: 'segredo-do-cron' }))
    expect(res.status).toBe(401)
    expect(avaliarEEnviar).not.toHaveBeenCalled()
  })

  it('401 não devolve o segredo esperado', async () => {
    const res = await POST(pedido({ authorization: 'Bearer outro' }))
    expect(JSON.stringify(await res.json())).not.toContain('segredo-do-cron')
  })

  it('segredo certo avalia e devolve o resumo', async () => {
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
    expect(avaliarEEnviar).toHaveBeenCalledTimes(1)
  })

  it('banco indisponível devolve 503 em vez de estourar', async () => {
    avaliarEEnviar.mockRejectedValueOnce(new Error('connection refused'))
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ erro: 'Banco indisponível.' })
  })

  it('falha ao montar as dependências (env do banco ausente) também vira 503', async () => {
    criarDependenciasAlertas.mockImplementationOnce(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente')
    })
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
  })

  it('sem segredo configurado no ambiente devolve 503', async () => {
    vi.stubEnv('ALERTAS_CRON_SECRET', '')
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
    expect(avaliarEEnviar).not.toHaveBeenCalled()
  })
})
