import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Sessão com permissão de visualizar no ShopFloor — mesmo gate do qrDaCaixa (lista de SNs).
const SESSAO_OK = {
  usuarioId: 'u1', nome: 'Ana', email: 'ana@x',
  perfil: { porModulo: { shopfloor: { visualizar: true } }, permissoes: {} },
}

const CAIXA_FECHADA = {
  seq: 3, posto: 'Integração', fechada: true, limite: 10,
  codigo: 'CX[3][10]12345-PMO973', qtd: 10, sns: ['SN1', 'SN2'], revisao: 0,
}
const CAIXA_ABERTA = {
  seq: 4, posto: 'Integração', fechada: false, limite: 10,
  codigo: 'CX4 (aberta)', qtd: 2, sns: ['SN3', 'SN4'], revisao: 0,
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/modules/shopfloor/infra/caixa-repository')
  vi.resetModules()
})

describe('qrCodigoDaCaixa — o QR do código final, pro bipe de mão no Almoxarifado', () => {
  it('caixa fechada: gera o QR e devolve o código exato (sem lista de SNs)', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => SESSAO_OK }))
    vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({
      carregarCaixasDaOp: async () => [CAIXA_FECHADA],
    }))
    const { qrCodigoDaCaixa } = await import('../embalagem-actions')
    const r = await qrCodigoDaCaixa('PMO973', '12345', 'Integração', 3)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('esperado ok:true')
    expect(r.codigo).toBe('CX[3][10]12345-PMO973')
    expect(r.svg).toContain('<svg')
  })

  it('caixa aberta: sem código final, devolve erro em vez de gerar QR', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => SESSAO_OK }))
    vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({
      carregarCaixasDaOp: async () => [CAIXA_ABERTA],
    }))
    const { qrCodigoDaCaixa } = await import('../embalagem-actions')
    const r = await qrCodigoDaCaixa('PMO973', '12345', 'Integração', 4)
    expect(r.ok).toBe(false)
  })

  it('caixa inexistente: erro amigável', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => SESSAO_OK }))
    vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({
      carregarCaixasDaOp: async () => [],
    }))
    const { qrCodigoDaCaixa } = await import('../embalagem-actions')
    const r = await qrCodigoDaCaixa('PMO973', '12345', 'Integração', 9)
    expect(r).toEqual({ ok: false, erro: 'Caixa não encontrada.' })
  })

  it('sem permissão de visualizar: recusa antes de consultar a caixa', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: { porModulo: {}, permissoes: {} } }),
    }))
    vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({
      carregarCaixasDaOp: async () => [CAIXA_FECHADA],
    }))
    const { qrCodigoDaCaixa } = await import('../embalagem-actions')
    const r = await qrCodigoDaCaixa('PMO973', '12345', 'Integração', 3)
    expect(r.ok).toBe(false)
  })
})
