import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSAO_GESTOR = {
  usuarioId: 'u1', nome: 'Gestor', email: 'g@x',
  perfil: { porModulo: { shopfloor: { administrar: true } }, permissoes: {} },
}
const SESSAO_OPERADOR = {
  usuarioId: 'u2', nome: 'Ana', email: 'a@x',
  perfil: { porModulo: { shopfloor: { lancar: true } }, permissoes: {} },
}

const CODIGO = 'CX[3][14]8498-PMOC14'

/** Registro lido do banco: uma das 14 linhas que o bipe da caixa gravou no Almoxarifado. */
const LINHA_DE_CAIXA = {
  pmo: 'PMOC14', op: '8498', numeroSerieNorm: '8003', posto: 'Almoxarifado', numeroCaixa: CODIGO,
}

interface Opcoes {
  sessao?: unknown
  registro?: unknown
  perfilRecurso?: string
  ehUltimo?: boolean
  pecas?: number | Error
  rpc?: { ok: true; canceladas: number } | { ok: false; erro: string }
}

function mocks(o: Opcoes = {}) {
  const chamarSfCancelarCaixa = vi.fn(async () => o.rpc ?? { ok: true as const, canceladas: 14 })
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => o.sessao ?? SESSAO_GESTOR,
  }))
  vi.doMock('@/modules/shopfloor/infra/cancelamento-repository', () => ({
    lerRegistroParaCancelar: async () => (o.registro === undefined ? LINHA_DE_CAIXA : o.registro),
    ehUltimoBipe: async () => o.ehUltimo ?? true,
    chamarSfCancelar: async () => ({ ok: true }),
    chamarSfCancelarCaixa,
    contarPecasDaEntradaDeCaixa: async () => {
      if (o.pecas instanceof Error) throw o.pecas
      return o.pecas ?? 14
    },
  }))
  vi.doMock('@/modules/shopfloor/infra/postos-repository', () => ({
    mapaPostoPerfil: async () => ({ Almoxarifado: { recurso: o.perfilRecurso ?? 'almoxarifado' } }),
  }))
  vi.doMock('@/modules/shopfloor/infra/caixa-repository', () => ({
    estadoCaixaDoRegistro: async () => null,
  }))
  return { chamarSfCancelarCaixa }
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/modules/shopfloor/infra/cancelamento-repository')
  vi.doUnmock('@/modules/shopfloor/infra/postos-repository')
  vi.doUnmock('@/modules/shopfloor/infra/caixa-repository')
  vi.resetModules()
})

describe('cancelavelInfo — entrada de caixa do Almoxarifado', () => {
  it('devolve a caixa e QUANTAS peças vão ser canceladas', async () => {
    // É o número que o diálogo mostra antes de confirmar: o clique foi numa linha, mas o alcance é a
    // caixa inteira. Sem ele, "cancelar a caixa inteira" seria um cheque em branco.
    mocks({ pecas: 14 })
    const { cancelavelInfo } = await import('../cancelamento-actions')

    const r = await cancelavelInfo('id-1')

    expect(r.podeCancelar).toBe(true)
    expect(r.caixa).toEqual({ numeroCaixa: CODIGO, pecas: 14 })
  })

  it('contagem que falha não bloqueia o cancelamento (a RPC conta de novo, na trava)', async () => {
    mocks({ pecas: new Error('rede') })
    const { cancelavelInfo } = await import('../cancelamento-actions')

    const r = await cancelavelInfo('id-1')

    expect(r.podeCancelar).toBe(true)
    expect(r.caixa).toEqual({ numeroCaixa: CODIGO, pecas: 0 })
  })

  it('entrada de OP individual (sem código de caixa) segue no cancelamento comum', async () => {
    mocks({ registro: { ...LINHA_DE_CAIXA, numeroCaixa: '' } })
    const { cancelavelInfo } = await import('../cancelamento-actions')

    const r = await cancelavelInfo('id-1')

    expect(r.podeCancelar).toBe(true)
    expect(r.caixa).toBeUndefined()
  })

  it('linha da Embalagem não vira "cancelar a caixa inteira" (lá o cancelamento reabre a caixa)', async () => {
    mocks({ perfilRecurso: 'caixa' })
    const { cancelavelInfo } = await import('../cancelamento-actions')

    const r = await cancelavelInfo('id-1')

    expect(r.caixa).toBeUndefined()
  })
})

describe('cancelarCaixaAlmoxarifado', () => {
  it('devolve quantas peças saíram, pra tela dizer "14 peças canceladas"', async () => {
    const { chamarSfCancelarCaixa } = mocks({ rpc: { ok: true, canceladas: 14 } })
    const { cancelarCaixaAlmoxarifado } = await import('../cancelamento-actions')

    const r = await cancelarCaixaAlmoxarifado('id-1', '  caixa bipada por engano  ')

    expect(r).toEqual({ ok: true, canceladas: 14 })
    // O motivo vai aparado, e é UM motivo pra todas as linhas.
    expect(chamarSfCancelarCaixa).toHaveBeenCalledWith('id-1', 'caixa bipada por engano')
  })

  it('motivo obrigatório: só espaço não vale e nem chega à RPC', async () => {
    const { chamarSfCancelarCaixa } = mocks()
    const { cancelarCaixaAlmoxarifado } = await import('../cancelamento-actions')

    const r = await cancelarCaixaAlmoxarifado('id-1', '   ')

    expect(r).toEqual({ ok: false, erro: 'Informe o motivo do cancelamento.' })
    expect(chamarSfCancelarCaixa).not.toHaveBeenCalled()
  })

  it('quem não administra o ShopFloor não cancela (nem chega à RPC)', async () => {
    const { chamarSfCancelarCaixa } = mocks({ sessao: SESSAO_OPERADOR })
    const { cancelarCaixaAlmoxarifado } = await import('../cancelamento-actions')

    const r = await cancelarCaixaAlmoxarifado('id-1', 'motivo')

    expect(r.ok).toBe(false)
    expect(chamarSfCancelarCaixa).not.toHaveBeenCalled()
  })

  it('NAO_E_ULTIMO vira frase: alguma peça da caixa tem bipe posterior', async () => {
    // A RPC recusa a caixa INTEIRA nesse caso, em vez de cancelar "as que dá" — meio dentro/meio fora
    // é justamente o estado que ela existe pra matar.
    mocks({ rpc: { ok: false, erro: 'erro: NAO_E_ULTIMO' } })
    const { cancelarCaixaAlmoxarifado } = await import('../cancelamento-actions')

    const r = await cancelarCaixaAlmoxarifado('id-1', 'motivo')

    expect(r).toEqual({
      ok: false,
      erro: 'Só o bipe mais recente do SN pode ser cancelado — cancele o mais recente primeiro.',
    })
  })

  it('caixa já cancelada: NAO_ENCONTRADO vira "talvez já cancelado"', async () => {
    mocks({ rpc: { ok: false, erro: 'erro: NAO_ENCONTRADO' } })
    const { cancelarCaixaAlmoxarifado } = await import('../cancelamento-actions')

    const r = await cancelarCaixaAlmoxarifado('id-1', 'motivo')

    expect(r).toEqual({ ok: false, erro: 'Registro não encontrado (talvez já cancelado).' })
  })

  it('NAO_E_ENTRADA_DE_CAIXA manda de volta pro cancelamento comum', async () => {
    mocks({ rpc: { ok: false, erro: 'erro: NAO_E_ENTRADA_DE_CAIXA' } })
    const { cancelarCaixaAlmoxarifado } = await import('../cancelamento-actions')

    const r = await cancelarCaixaAlmoxarifado('id-1', 'motivo')

    expect(r).toEqual({
      ok: false, erro: 'Este registro não é uma entrada de caixa — use Cancelar lançamento.',
    })
  })

  it('erro que não é código conhecido cai no texto da caixa, não no do lançamento', async () => {
    mocks({ rpc: { ok: false, erro: 'connection reset' } })
    const { cancelarCaixaAlmoxarifado } = await import('../cancelamento-actions')

    const r = await cancelarCaixaAlmoxarifado('id-1', 'motivo')

    expect(r).toEqual({ ok: false, erro: 'Não foi possível cancelar a caixa.' })
  })
})
