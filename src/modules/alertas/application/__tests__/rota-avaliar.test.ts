// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { criarDependenciasAlertas, avaliarEEnviar, sincronizarFinalizacaoDasOps } = vi.hoisted(() => ({
  criarDependenciasAlertas: vi.fn(() => ({ portas: {}, repo: {} })),
  avaliarEEnviar: vi.fn(async () => ({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })),
  sincronizarFinalizacaoDasOps: vi.fn(async () => ({ finalizadas: 0, reabertas: 0 })),
}))
vi.mock('@/modules/alertas/infra/fabrica', () => ({ criarDependenciasAlertas }))
vi.mock('@/modules/alertas/application/enviar-alertas', () => ({ avaliarEEnviar }))
vi.mock('@/modules/shopfloor/infra/finalizacao-repository', () => ({ sincronizarFinalizacaoDasOps }))

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
  sincronizarFinalizacaoDasOps.mockResolvedValue({ finalizadas: 0, reabertas: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
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

  describe('finalização automática de OP', () => {
    it('roda DEPOIS de os alertas terminarem', async () => {
      const ordem: string[] = []
      avaliarEEnviar.mockImplementationOnce(async () => {
        ordem.push('alertas:inicio')
        await new Promise((r) => setTimeout(r, 5))
        ordem.push('alertas:fim')
        return { avaliadas: 1, enviados: 1, falhas: 0, ocupado: false }
      })
      sincronizarFinalizacaoDasOps.mockImplementationOnce(async () => {
        ordem.push('finalizacao')
        return { finalizadas: 1, reabertas: 0 }
      })
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(res.status).toBe(200)
      expect(ordem).toEqual(['alertas:inicio', 'alertas:fim', 'finalizacao'])
    })

    it('a resposta continua sendo exatamente a dos alertas, com ou sem OP finalizada', async () => {
      sincronizarFinalizacaoDasOps.mockResolvedValueOnce({ finalizadas: 3, reabertas: 1 })
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(await res.json()).toEqual({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
    })

    it('CASO 8: erro na finalização não impede os alertas de sair nem muda a resposta', async () => {
      sincronizarFinalizacaoDasOps.mockRejectedValueOnce(new Error('função inexistente'))
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(avaliarEEnviar).toHaveBeenCalledTimes(1)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
    })

    it('CASO 8: erro SÍNCRONO na finalização (ex.: env ausente) também não muda a resposta', async () => {
      sincronizarFinalizacaoDasOps.mockImplementationOnce(() => {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente')
      })
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ avaliadas: 2, enviados: 3, falhas: 0, ocupado: false })
    })

    it('se os alertas falham (503), a finalização não roda', async () => {
      avaliarEEnviar.mockRejectedValueOnce(new Error('connection refused'))
      const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
      expect(res.status).toBe(503)
      expect(sincronizarFinalizacaoDasOps).not.toHaveBeenCalled()
    })

    it('sem autorização, nenhuma das duas roda', async () => {
      await POST(pedido())
      expect(sincronizarFinalizacaoDasOps).not.toHaveBeenCalled()
    })
  })
})
