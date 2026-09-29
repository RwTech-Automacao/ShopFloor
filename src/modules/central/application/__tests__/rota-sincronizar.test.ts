// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type ResultadoSincronizacaoDeMentira =
  | { etapa: 'leitura'; ok: false; erro: string }
  | { etapa: 'montagem'; ok: false; erro: string }
  | { etapa: 'envio'; ok: false; erro: string }
  | { etapa: 'central'; ok: true; status: number; corpo: unknown }

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { criarDependenciasCentral, sincronizar } = vi.hoisted(() => ({
  criarDependenciasCentral: vi.fn(() => ({ leitor: {}, enviador: {} })),
  sincronizar: vi.fn(
    async (): Promise<ResultadoSincronizacaoDeMentira> => ({ etapa: 'central', ok: true, status: 200, corpo: { resumo: {} } }),
  ),
}))
vi.mock('@/modules/central/infra/fabrica', () => ({ criarDependenciasCentral }))
vi.mock('@/modules/central/application/sincronizar', () => ({ sincronizar }))

import { POST } from '@/app/api/central/sincronizar/route'

function pedido(cabecalhos: Record<string, string> = {}) {
  return new Request('https://shopfloor.enterplak.com.br/api/central/sincronizar', {
    method: 'POST',
    headers: cabecalhos,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  criarDependenciasCentral.mockReturnValue({ leitor: {}, enviador: {} })
  sincronizar.mockResolvedValue({ etapa: 'central', ok: true, status: 200, corpo: { resumo: { ok: true } } })
  vi.stubEnv('CENTRAL_SYNC_CRON_SECRET', 'segredo-do-cron')
  vi.stubEnv('CENTRAL_SYNC_SECRET', 'segredo-pra-central')
  vi.stubEnv('CENTRAL_SYNC_URL', 'http://127.0.0.1:3100')
})

describe('POST /api/central/sincronizar', () => {
  it('sem nenhuma das três variáveis configuradas devolve 503 e nem confere autorização', async () => {
    vi.stubEnv('CENTRAL_SYNC_CRON_SECRET', '')
    vi.stubEnv('CENTRAL_SYNC_SECRET', '')
    vi.stubEnv('CENTRAL_SYNC_URL', '')
    const res = await POST(pedido())
    expect(res.status).toBe(503)
    expect(sincronizar).not.toHaveBeenCalled()
  })

  it('só CENTRAL_SYNC_CRON_SECRET vazia já devolve 503', async () => {
    vi.stubEnv('CENTRAL_SYNC_CRON_SECRET', '')
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
  })

  it('só CENTRAL_SYNC_SECRET vazia já devolve 503', async () => {
    vi.stubEnv('CENTRAL_SYNC_SECRET', '')
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
  })

  it('só CENTRAL_SYNC_URL vazia já devolve 503', async () => {
    vi.stubEnv('CENTRAL_SYNC_URL', '')
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
  })

  it('CENTRAL_SYNC_URL http num host que não é loopback devolve 503 (segredo não pode viajar em texto claro)', async () => {
    vi.stubEnv('CENTRAL_SYNC_URL', 'http://central.enterplak.com.br')
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
    expect(criarDependenciasCentral).not.toHaveBeenCalled()
    expect(sincronizar).not.toHaveBeenCalled()
  })

  it('CENTRAL_SYNC_URL https é sempre aceita, mesmo fora do loopback', async () => {
    vi.stubEnv('CENTRAL_SYNC_URL', 'https://central.enterplak.com.br')
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(200)
  })

  it('sem cabeçalho de autorização devolve 401 e não sincroniza', async () => {
    const res = await POST(pedido())
    expect(res.status).toBe(401)
    expect(sincronizar).not.toHaveBeenCalled()
  })

  it('segredo errado devolve 401', async () => {
    const res = await POST(pedido({ authorization: 'Bearer outro' }))
    expect(res.status).toBe(401)
  })

  it('segredo certo sem o prefixo Bearer devolve 401', async () => {
    const res = await POST(pedido({ authorization: 'segredo-do-cron' }))
    expect(res.status).toBe(401)
  })

  it('401 não devolve o segredo esperado no corpo', async () => {
    const res = await POST(pedido({ authorization: 'Bearer outro' }))
    expect(JSON.stringify(await res.json())).not.toContain('segredo-do-cron')
  })

  it('segredo certo sincroniza e devolve 200 com o corpo (resumo) que a Central mandou', async () => {
    sincronizar.mockResolvedValue({ etapa: 'central', ok: true, status: 200, corpo: { resumo: { recebimentos: { novos: 3 } } } })
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ resumo: { recebimentos: { novos: 3 } } })
    expect(sincronizar).toHaveBeenCalledTimes(1)
  })

  it('banco indisponível (etapa "leitura") devolve 503', async () => {
    sincronizar.mockResolvedValue({ etapa: 'leitura', ok: false, erro: 'connection refused' })
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
  })

  it('Central fora do ar (etapa "envio") devolve 502', async () => {
    sincronizar.mockResolvedValue({ etapa: 'envio', ok: false, erro: 'fetch failed' })
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(502)
  })

  it('Central responde 500 -> 502', async () => {
    sincronizar.mockResolvedValue({ etapa: 'central', ok: true, status: 500, corpo: { erro: 'boom' } })
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(502)
  })

  it('Central responde 409 (foto vazia) -> 502 também (não é sucesso)', async () => {
    sincronizar.mockResolvedValue({ etapa: 'central', ok: true, status: 409, corpo: { erro: 'Foto vazia' } })
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(502)
  })

  it('falha ao montar as dependências (env do banco ausente) vira 503', async () => {
    criarDependenciasCentral.mockImplementationOnce(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente')
    })
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(503)
    expect(sincronizar).not.toHaveBeenCalled()
  })

  it('etapa "montagem" (situação fora do contrato) devolve 500, sem vazar o detalhe interno no corpo', async () => {
    sincronizar.mockResolvedValue({ etapa: 'montagem', ok: false, erro: 'situação fora do contrato: "cancelado"' })
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(500)
    const corpo = await res.json()
    expect(corpo).toHaveProperty('erro')
    expect(JSON.stringify(corpo)).not.toContain('cancelado')
  })

  it('sincronizar lança de forma inesperada -> try/catch de último recurso devolve 500', async () => {
    sincronizar.mockRejectedValueOnce(new Error('bug inesperado'))
    const res = await POST(pedido({ authorization: 'Bearer segredo-do-cron' }))
    expect(res.status).toBe(500)
  })
})
