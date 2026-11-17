// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const sincronizarPlanilha = vi.fn()
vi.mock('@/modules/sat/application/sincronizar-planilha', () => ({ sincronizarPlanilha }))
vi.mock('@/modules/sat/infra/os-repository', () => ({ gravarOsDoServico: () => async () => ({}) }))

const pedido = (auth?: string) =>
  new Request('http://127.0.0.1:3000/api/sat/sincronizar-planilha', {
    method: 'POST', headers: auth ? { authorization: auth } : {},
  })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('POST /api/sat/sincronizar-planilha', () => {
  it('sem ESTOQUE_CRON_SECRET no ambiente: 503 e não lê a planilha', async () => {
    vi.stubEnv('ESTOQUE_CRON_SECRET', '')
    const { POST } = await import('@/app/api/sat/sincronizar-planilha/route')
    expect((await POST(pedido('Bearer x'))).status).toBe(503)
    expect(sincronizarPlanilha).not.toHaveBeenCalled()
  })

  it('segredo errado ou ausente: 401', async () => {
    vi.stubEnv('ESTOQUE_CRON_SECRET', 'segredo-de-teste')
    const { POST } = await import('@/app/api/sat/sincronizar-planilha/route')
    expect((await POST(pedido('Bearer outro'))).status).toBe(401)
    expect((await POST(pedido())).status).toBe(401)
    expect(sincronizarPlanilha).not.toHaveBeenCalled()
  })

  it('segredo certo: sincroniza e devolve o resumo; falha geral = 503 (o curl -f do cron vê)', async () => {
    vi.stubEnv('ESTOQUE_CRON_SECRET', 'segredo-de-teste')
    const { POST } = await import('@/app/api/sat/sincronizar-planilha/route')
    const resumo = { abas: [], os: 1, itens: 2, gravado: { os_novas: 1, os_atualizadas: 0, itens_novos: 2, itens_atualizados: 0 } }
    sincronizarPlanilha.mockResolvedValueOnce(resumo)
    const ok = await POST(pedido('Bearer segredo-de-teste'))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual(resumo)
    sincronizarPlanilha.mockRejectedValueOnce(new Error('nenhuma aba'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(pedido('Bearer segredo-de-teste'))).status).toBe(503)
  })
})
