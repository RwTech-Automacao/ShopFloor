// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Supabase de mentira com service role: a fila (`sf_almox_pendencias_base`), o responsável
 * (`alerta_ficha_responsavel`) e `sf_ordens`.
 */
let fila: unknown[] = []
let erroFila: { message: string } | null = null
let criouCliente = 0
const rpcs: { nome: string; args: unknown }[] = []

function cliente() {
  criouCliente += 1
  return {
    rpc: async (nome: string, args?: unknown) => {
      rpcs.push({ nome, args })
      if (nome === 'sf_almox_pendencias_base') return erroFila ? { data: null, error: erroFila } : { data: fila, error: null }
      if (nome === 'alerta_ficha_responsavel') return { data: 'Tiago', error: null }
      return { data: null, error: { message: 'rpc desconhecida' } }
    },
    from: () => {
      const q = {
        select: () => q,
        in: async () => ({ data: [{ pmo: 'PMOF52_F', op: '8682_F', descricao: 'FONTE 12V', qtd: 1000 }], error: null }),
      }
      return q
    },
  }
}

vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => cliente() }))

const { GET } = await import('@/app/quiosque/fichas/route')

const CHAVE = 'chave-do-tablet-de-teste'

function pedido(query = '') {
  return new Request(`https://shopfloor.enterplak.com.br/quiosque/fichas${query}`)
}

const CAIXA = {
  pmo: 'PMOF52_F', op: '8682_F', tipo: 'caixa', codigo: 'CX[1][160]8682_F-PMOF52_F', seq: 1, pecas: 160,
  lote_id: null, amostra: null, ja_lancadas: 0, em: '2026-11-06T00:30:00Z',
}

beforeEach(() => {
  fila = [CAIXA]
  erroFila = null
  criouCliente = 0
  rpcs.length = 0
  vi.stubEnv('FICHAS_TABLET_CHAVE', CHAVE)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /quiosque/fichas', () => {
  it('sem chave: 404 e nem toca no banco', async () => {
    const res = await GET(pedido())
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(criouCliente).toBe(0)
  })

  it('chave errada: 404 e nem toca no banco', async () => {
    const res = await GET(pedido('?k=outra-chave'))
    expect(res.status).toBe(404)
    expect(criouCliente).toBe(0)
  })

  it('variável vazia = página desligada, mesmo com k vazio', async () => {
    vi.stubEnv('FICHAS_TABLET_CHAVE', '')
    expect((await GET(pedido('?k='))).status).toBe(404)
    expect((await GET(pedido(`?k=${CHAVE}`))).status).toBe(404)
    expect(criouCliente).toBe(0)
  })

  it('chave certa: 200, HTML sem cache, com o código, o QR em PNG embutido e os campos da ficha', async () => {
    const res = await GET(pedido(`?k=${CHAVE}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const h = await res.text()
    expect(h).toContain('CX[1][160]8682_F-PMOF52_F')
    expect(h).toContain('src="data:image/png;base64,')
    expect(h).toContain('FONTE 12V')
    expect(h).toContain('Tiago')
    expect(h).not.toContain(CHAVE)
    expect(rpcs).toContainEqual({
      nome: 'alerta_ficha_responsavel',
      args: { p_tipo: 'caixa', p_pmo: 'PMOF52_F', p_op: '8682_F', p_chave: 'CX[1][160]8682_F-PMOF52_F' },
    })
  })

  it('fila vazia: 200 com a frase de vazio', async () => {
    fila = []
    const res = await GET(pedido(`?k=${CHAVE}`))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Nenhuma caixa ou lote esperando confirmação.')
  })

  it('falha ao ler a fila: 503 com a página de erro (nunca "nenhuma"), sem a chave no log', async () => {
    erroFila = { message: 'connection refused' }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(pedido(`?k=${CHAVE}`))
    expect(res.status).toBe(503)
    const h = await res.text()
    expect(h).toContain('Não foi possível carregar a lista agora.')
    expect(h).not.toContain('Nenhuma caixa')
    expect(JSON.stringify(log.mock.calls)).not.toContain(CHAVE)
    log.mockRestore()
  })
})
