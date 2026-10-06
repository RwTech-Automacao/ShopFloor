// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ResultadoSsoDashboard } from '../sso-dashboard'

vi.mock('server-only', () => ({}))

// A rota é fina de propósito: quem decide é `entrarPorSsoDashboard` (testado à parte). O que se
// testa aqui é o que SÓ a rota faz — o 307 com o `next` CRU no Location e a página de erro.
const { entrarPorSsoDashboard } = vi.hoisted(() => ({
  entrarPorSsoDashboard: vi.fn<() => Promise<ResultadoSsoDashboard>>(),
}))
vi.mock('@/modules/auth/application/sso-dashboard', () => ({ entrarPorSsoDashboard }))

import { GET, dynamic } from '@/app/embed/sso/route'

const pedido = (query: string) =>
  new Request(`https://shopfloor.enterplak.com.br/embed/sso${query}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DASHBOARD_ORIGIN', 'https://dashboard.enterplak.com.br')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /embed/sso', () => {
  it('não é cacheável: a resposta grava cookie de sessão', () => {
    expect(dynamic).toBe('force-dynamic')
  })

  it('repassa token e next da query string', async () => {
    entrarPorSsoDashboard.mockResolvedValue({ ok: true, next: '/embed/fluxo/A/1' })
    await GET(pedido('?token=abc.def.ghi&next=%2Fembed%2Ffluxo%2FA%2F1'))
    expect(entrarPorSsoDashboard).toHaveBeenCalledWith('abc.def.ghi', '/embed/fluxo/A/1')
  })

  it('sucesso → 307 com Location RELATIVO', async () => {
    entrarPorSsoDashboard.mockResolvedValue({ ok: true, next: '/embed/fluxo/PMOC13/2340%2F26' })
    const r = await GET(pedido('?token=t&next=x'))
    expect(r.status).toBe(307)
    // ⚠️ CRU, caractere por caractere: `new URL(...).pathname` ou um decode a mais quebrariam a OP
    // com `/` no nome (2340/26) e transformariam o duplo encoding em travessia de verdade.
    expect(r.headers.get('Location')).toBe('/embed/fluxo/PMOC13/2340%2F26')
    expect(await r.text()).toBe('')
  })

  it('sucesso → o Location preserva a query string do destino', async () => {
    entrarPorSsoDashboard.mockResolvedValue({ ok: true, next: '/embed/fluxo/A/1?modo=tv' })
    const r = await GET(pedido('?token=t&next=x'))
    expect(r.headers.get('Location')).toBe('/embed/fluxo/A/1?modo=tv')
  })

  it('sucesso → o Location preserva o duplo encoding', async () => {
    entrarPorSsoDashboard.mockResolvedValue({ ok: true, next: '/embed/%252e%252e/home' })
    const r = await GET(pedido('?token=t&next=x'))
    expect(r.headers.get('Location')).toBe('/embed/%252e%252e/home')
  })

  it('falha → página HTML em PT-BR com o status da aplicação, não JSON', async () => {
    entrarPorSsoDashboard.mockResolvedValue({
      ok: false,
      status: 403,
      erro: 'Usuário dashboard@enterplak.com.br não cadastrado no Shopfloor.',
      codigo: 'forbidden',
    })
    const r = await GET(pedido('?token=t&next=x'))
    const corpo = await r.text()

    expect(r.status).toBe(403)
    expect(r.headers.get('Content-Type')).toContain('text/html')
    expect(corpo).toContain('lang="pt-BR"')
    expect(corpo).toContain('Usuário dashboard@enterplak.com.br não cadastrado no Shopfloor.')
  })

  it('falha → avisa o pai por postMessage na origem do dashboard, nunca em "*"', async () => {
    entrarPorSsoDashboard.mockResolvedValue({
      ok: false,
      status: 403,
      erro: 'Usuário inativo.',
      codigo: 'inactive',
    })
    const corpo = await (await GET(pedido('?token=t&next=x'))).text()

    expect(corpo).toContain('postMessage')
    expect(corpo).toContain('sf-embed:error')
    expect(corpo).toContain('"inactive"')
    expect(corpo).toContain('"https://dashboard.enterplak.com.br"')
    expect(corpo).not.toContain("'*'")
    expect(corpo).not.toContain('"*"')
  })

  it('sem DASHBOARD_ORIGIN configurado NÃO manda postMessage (não existe alvo seguro)', async () => {
    vi.stubEnv('DASHBOARD_ORIGIN', '')
    entrarPorSsoDashboard.mockResolvedValue({ ok: false, status: 503, erro: 'Fora do ar.', codigo: null })
    const corpo = await (await GET(pedido('?token=t&next=x'))).text()

    expect(corpo).toContain('Fora do ar.')
    expect(corpo).not.toContain('postMessage')
  })

  it('a mensagem vai escapada: nada de HTML vindo de dentro do erro', async () => {
    entrarPorSsoDashboard.mockResolvedValue({
      ok: false,
      status: 403,
      erro: 'Usuário <script>alert(1)</script> não cadastrado.',
      codigo: 'forbidden',
    })
    const corpo = await (await GET(pedido('?token=t&next=x'))).text()

    expect(corpo).not.toContain('<script>alert(1)</script>')
    expect(corpo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('a resposta de falha não é guardada em cache', async () => {
    entrarPorSsoDashboard.mockResolvedValue({ ok: false, status: 401, erro: 'Token inválido.', codigo: null })
    const r = await GET(pedido('?token=t&next=x'))
    expect(r.headers.get('Cache-Control')).toContain('no-store')
  })

  it('a URL e o token não aparecem em log nenhum da rota', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    entrarPorSsoDashboard.mockResolvedValue({ ok: false, status: 401, erro: 'Token inválido.', codigo: null })

    await GET(pedido('?token=SEGREDO-NO-TOKEN&next=%2Fembed%2Ffluxo%2FA%2F1'))

    const impresso = [...aviso.mock.calls, ...log.mock.calls, ...erro.mock.calls]
      .flat()
      .map(String)
      .join(' | ')
    expect(impresso).not.toContain('SEGREDO-NO-TOKEN')
    aviso.mockRestore()
    log.mockRestore()
    erro.mockRestore()
  })
})
