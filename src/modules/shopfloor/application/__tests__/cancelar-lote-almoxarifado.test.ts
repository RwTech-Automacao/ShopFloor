import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSAO_GESTOR = {
  usuarioId: 'u1', nome: 'Gestor', email: 'g@x',
  perfil: { porModulo: { shopfloor: { administrar: true } }, permissoes: {} },
}
const SESSAO_RECEBIMENTO = {
  usuarioId: 'u2', nome: 'Ana', email: 'a@x',
  perfil: { porModulo: { recebimento: { lancar: true }, shopfloor: { lancar: true } }, permissoes: {} },
}

/** Uma das 5 linhas que a confirmação do lote gravou no Almoxarifado (numero_caixa vazio, envio_id). */
const LINHA_DE_LOTE = {
  pmo: 'PMOL01', op: '9201', numeroSerieNorm: '7003', posto: 'Almoxarifado', numeroCaixa: '', envioId: 'env-1',
}

interface Opcoes {
  sessao?: unknown
  registro?: unknown
  lote?: { rotulo: string; pecas: number } | null | Error
  rpc?: { ok: true; canceladas: number } | { ok: false; erro: string }
}

function mocks(o: Opcoes = {}) {
  const chamarSfCancelarLote = vi.fn(async () => o.rpc ?? { ok: true as const, canceladas: 5 })
  const chamarSfCancelar = vi.fn(async () => ({ ok: false as const, erro: 'CANCELE_O_LOTE' }))
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => o.sessao ?? SESSAO_GESTOR,
  }))
  vi.doMock('@/modules/shopfloor/infra/cancelamento-repository', () => ({
    lerRegistroParaCancelar: async () => (o.registro === undefined ? LINHA_DE_LOTE : o.registro),
    ehUltimoBipe: async () => true,
    chamarSfCancelar,
    chamarSfCancelarCaixa: async () => ({ ok: true, canceladas: 0 }),
    contarPecasDaEntradaDeCaixa: async () => 0,
    lerLoteDaEntrada: async () => {
      if (o.lote instanceof Error) throw o.lote
      return o.lote === undefined ? { rotulo: 'LOTE[abcd1234][5]', pecas: 5 } : o.lote
    },
    chamarSfCancelarLote,
  }))
  vi.doMock('@/modules/shopfloor/infra/postos-repository', () => ({
    mapaPostoPerfil: async () => ({ Almoxarifado: { recurso: 'almoxarifado' } }),
  }))
  vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({ estadoCaixaDoRegistro: async () => null }))
  return { chamarSfCancelarLote, chamarSfCancelar }
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/modules/shopfloor/infra/cancelamento-repository')
  vi.doUnmock('@/modules/shopfloor/infra/postos-repository')
  vi.doUnmock('@/modules/shopfloor/infra/caixa-repository')
  vi.resetModules()
})

describe('cancelavelInfo — entrada de LOTE do Almoxarifado (0156)', () => {
  it('devolve o lote e QUANTAS peças vão ser canceladas (e não oferece a caixa)', async () => {
    mocks()
    const { cancelavelInfo } = await import('../cancelamento-actions')

    const r = await cancelavelInfo('id-1')

    expect(r).toEqual({ podeCancelar: true, lote: { rotulo: 'LOTE[abcd1234][5]', pecas: 5 } })
  })

  it('envio que não é de lote (entrada avulsa com envio_id nulo): cancelamento de sempre', async () => {
    mocks({ registro: { ...LINHA_DE_LOTE, envioId: '' } })
    const { cancelavelInfo } = await import('../cancelamento-actions')

    const r = await cancelavelInfo('id-1')

    expect(r.podeCancelar).toBe(true)
    expect(r.lote).toBeUndefined()
    expect(r.caixa).toBeUndefined()
  })

  it('envio_id que não aponta pra envio de lote: cancelamento de sempre', async () => {
    mocks({ lote: null })
    const { cancelavelInfo } = await import('../cancelamento-actions')

    const r = await cancelavelInfo('id-1')

    expect(r.podeCancelar).toBe(true)
    expect(r.lote).toBeUndefined()
  })

  it('falha ao ler o lote: fail-closed (não oferece o cancelamento da linha avulsa)', async () => {
    mocks({ lote: new Error('rede') })
    const { cancelavelInfo } = await import('../cancelamento-actions')

    expect(await cancelavelInfo('id-1')).toEqual({ podeCancelar: false, motivo: 'Não foi possível verificar.' })
  })
})

describe('cancelarLoteAlmoxarifado (0156)', () => {
  it('chama a RPC com o id e o motivo aparado, e devolve quantas peças saíram', async () => {
    const { chamarSfCancelarLote } = mocks()
    const { cancelarLoteAlmoxarifado } = await import('../cancelamento-actions')

    expect(await cancelarLoteAlmoxarifado('id-1', '  lote errado  ')).toEqual({ ok: true, canceladas: 5 })
    expect(chamarSfCancelarLote).toHaveBeenCalledWith('id-1', 'lote errado')
  })

  it('só shopfloor.administrar: quem só tem recebimento.lancar não cancela', async () => {
    const { chamarSfCancelarLote } = mocks({ sessao: SESSAO_RECEBIMENTO })
    const { cancelarLoteAlmoxarifado } = await import('../cancelamento-actions')

    expect(await cancelarLoteAlmoxarifado('id-1', 'x')).toEqual({ ok: false, erro: 'Você não tem permissão para cancelar.' })
    expect(chamarSfCancelarLote).not.toHaveBeenCalled()
  })

  it('motivo vazio é recusado antes do banco', async () => {
    const { chamarSfCancelarLote } = mocks()
    const { cancelarLoteAlmoxarifado } = await import('../cancelamento-actions')

    expect(await cancelarLoteAlmoxarifado('id-1', '   ')).toEqual({ ok: false, erro: 'Informe o motivo do cancelamento.' })
    expect(chamarSfCancelarLote).not.toHaveBeenCalled()
  })

  it('códigos da RPC viram frase', async () => {
    mocks({ rpc: { ok: false, erro: 'NAO_E_ENTRADA_DE_LOTE' } })
    let mod = await import('../cancelamento-actions')
    expect(await mod.cancelarLoteAlmoxarifado('id-1', 'x')).toEqual({
      ok: false, erro: 'Este registro não é uma entrada de lote — use Cancelar lançamento.',
    })
    vi.resetModules()
    mocks({ rpc: { ok: false, erro: 'NAO_E_ULTIMO' } })
    mod = await import('../cancelamento-actions')
    expect(await mod.cancelarLoteAlmoxarifado('id-1', 'x')).toEqual({
      ok: false, erro: 'Só o bipe mais recente do SN pode ser cancelado — cancele o mais recente primeiro.',
    })
  })

  it('cancelar UMA linha do lote pelo cancelamento de lançamento: a recusa CANCELE_O_LOTE vira frase', async () => {
    mocks()
    const { cancelarLancamento } = await import('../cancelamento-actions')
    expect(await cancelarLancamento('id-1', 'uma peça')).toEqual({
      ok: false, erro: 'Esta peça entrou com um lote do NQA: cancele o lote inteiro.',
    })
  })
})
