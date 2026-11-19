import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSAO_GESTOR = {
  usuarioId: 'u1', nome: 'Gestor', email: 'g@x',
  perfil: { porModulo: { shopfloor: { administrar: true } }, permissoes: {} },
}
const REGISTRO = { pmo: 'PMOE', op: '9100', numeroSerieNorm: 'a001', posto: 'Inspeção AOI TOP', numeroCaixa: '', envioId: '' }
const INTEGRADA = { placa: 'A001', produto: '110', codigo: 'INT-20261119-101010-ABCD' }

function mocks(o: { integrada?: typeof INTEGRADA | null | Error; rpcErro?: string } = {}) {
  const placaIntegradaAtiva = vi.fn(async () => {
    if (o.integrada instanceof Error) throw o.integrada
    return o.integrada ?? null
  })
  vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => SESSAO_GESTOR }))
  vi.doMock('@/modules/shopfloor/infra/cancelamento-repository', () => ({
    lerRegistroParaCancelar: async () => REGISTRO,
    ehUltimoBipe: async () => true,
    placaIntegradaAtiva,
    chamarSfCancelar: async () => (o.rpcErro ? { ok: false, erro: o.rpcErro } : { ok: true }),
    chamarSfCancelarCaixa: vi.fn(),
    contarPecasDaEntradaDeCaixa: vi.fn(),
    lerLoteDaEntrada: vi.fn(),
    chamarSfCancelarLote: vi.fn(),
  }))
  vi.doMock('@/modules/shopfloor/infra/postos-repository', () => ({
    mapaPostoPerfil: async () => ({ 'Inspeção AOI TOP': { recurso: 'nenhum' } }),
  }))
  vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({ estadoCaixaDoRegistro: async () => null }))
  return { placaIntegradaAtiva }
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/modules/shopfloor/infra/cancelamento-repository')
  vi.doUnmock('@/modules/shopfloor/infra/postos-repository')
  vi.doUnmock('@/modules/shopfloor/infra/caixa-repository')
  vi.resetModules()
})

describe('cancelar o bipe de uma placa integrada (0195)', () => {
  it('a tela não oferece o cancelamento e explica', async () => {
    const { placaIntegradaAtiva } = mocks({ integrada: INTEGRADA })
    const { cancelavelInfo } = await import('../cancelamento-actions')
    expect(await cancelavelInfo('id-1')).toEqual({
      podeCancelar: false,
      motivo: 'A placa A001 está integrada no produto 110 (INT-20261119-101010-ABCD). Desfaça a integração antes.',
    })
    expect(placaIntegradaAtiva).toHaveBeenCalledWith('9100', 'a001')
  })
  it('SN que não é placa integrada: como antes', async () => {
    mocks()
    const { cancelavelInfo } = await import('../cancelamento-actions')
    expect(await cancelavelInfo('id-1')).toEqual({ podeCancelar: true, aviso: undefined })
  })
  it('falha ao conferir: fail-closed', async () => {
    mocks({ integrada: new Error('x') })
    const { cancelavelInfo } = await import('../cancelamento-actions')
    expect(await cancelavelInfo('id-1')).toEqual({ podeCancelar: false, motivo: 'Não foi possível verificar.' })
  })
  it('a recusa do banco vira a mensagem em PT-BR', async () => {
    mocks({ rpcErro: 'PLACA_INTEGRADA:A001|110|INT-20261119-101010-ABCD' })
    const { cancelarLancamento } = await import('../cancelamento-actions')
    expect(await cancelarLancamento('id-1', 'erro')).toEqual({
      ok: false, erro: 'A placa A001 está integrada no produto 110 (INT-20261119-101010-ABCD). Desfaça a integração antes.',
    })
  })
})
