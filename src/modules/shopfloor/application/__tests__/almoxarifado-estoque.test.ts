import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSAO_OK = {
  usuarioId: 'u1', nome: 'Ana', email: 'ana@x',
  perfil: { porModulo: { recebimento: { lancar: true } }, permissoes: {} },
}
const SESSAO_SEM = { ...SESSAO_OK, perfil: { porModulo: {}, permissoes: {} } }

type Rpc = (nome: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }

function mocks(rpc: Rpc, sessao: unknown = SESSAO_OK, individual = false) {
  const chamadas: { nome: string; args: Record<string, unknown> }[] = []
  vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => sessao }))
  vi.doMock('@/modules/shopfloor/infra/lancamento-repository', () => ({
    carregarOrdem: async () => ({ embalagem_individual: individual }),
  }))
  vi.doMock('@/shared/lib/supabase/server', () => ({
    createServerSupabase: async () => ({
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadas.push({ nome, args })
        return rpc(nome, args)
      },
    }),
  }))
  return chamadas
}

const EINTER_ENV = () => {
  vi.stubEnv('COMPELS_ESTOQUE_EINTER_ID', '301')
  vi.stubEnv('COMPELS_LOCACAO_EINTER_ID', '7001')
}

const BIPE = { pmo: 'PMOC14', op: '8498', posto: 'Almoxarifado', colaborador: 'Ana', bipe: 'CX[3][14]8498-PMOC14' }
const LOTE = { pmo: 'PMOL01', op: '9201', posto: 'Almoxarifado', colaborador: 'Ana', loteId: 'l1', amostra: ['1', '2'] }

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/modules/shopfloor/infra/lancamento-repository')
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('registrarEntradaAlmoxarifado — estoque de destino', () => {
  it('sem escolha: chama o banco EXATAMENTE como antes da 0175 (sem p_estoque) e responde PA', async () => {
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 14 }, error: null }))
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await registrarEntradaAlmoxarifado(BIPE)
    expect(r).toMatchObject({ ok: true, estoque: 'PA' })
    expect(Object.keys(chamadas[0]!.args).sort()).toEqual(
      ['p_bipe', 'p_colaborador', 'p_op', 'p_pmo', 'p_posto', 'p_quantidade', 'p_serie_norm', 'p_tipo'],
    )
  })

  it('PA explícito também não manda p_estoque (a janela entre a migração e o app não quebra nada)', async () => {
    EINTER_ENV()
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 14 }, error: null }))
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await registrarEntradaAlmoxarifado({ ...BIPE, estoque: 'PA' })).toMatchObject({ ok: true, estoque: 'PA' })
    expect(chamadas[0]!.args).not.toHaveProperty('p_estoque')
  })

  it('EINTER configurado: manda p_estoque = EINTER e responde EINTER', async () => {
    EINTER_ENV()
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 14 }, error: null }))
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await registrarEntradaAlmoxarifado({ ...BIPE, estoque: 'EINTER' })).toMatchObject({ ok: true, estoque: 'EINTER' })
    expect(chamadas[0]!.args).toMatchObject({ p_estoque: 'EINTER' })
  })

  it('EINTER SEM configuração: o servidor recusa com frase clara e não toca o banco', async () => {
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 14 }, error: null }))
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await registrarEntradaAlmoxarifado({ ...BIPE, estoque: 'EINTER' })
    expect(r).toEqual({ ok: false, erro: 'O estoque EINTER ainda não está disponível neste ambiente. Escolha PA.' })
    expect(chamadas).toEqual([])
  })

  it('EINTER configurado pela metade também recusa', async () => {
    vi.stubEnv('COMPELS_ESTOQUE_EINTER_ID', '301')
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 14 }, error: null }))
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    expect((await registrarEntradaAlmoxarifado({ ...BIPE, estoque: 'EINTER' })).ok).toBe(false)
    expect(chamadas).toEqual([])
  })

  it('valor que não é PA nem EINTER (nem minúsculo) é recusado sem tocar o banco', async () => {
    EINTER_ENV()
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 14 }, error: null }))
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    for (const ruim of ['XYZ', 'einter', 'pa', 'PA; drop', ' EINTER']) {
      const r = await registrarEntradaAlmoxarifado({ ...BIPE, estoque: ruim })
      expect(r).toEqual({ ok: false, erro: 'Estoque de destino inválido: escolha PA ou EINTER.' })
    }
    expect(chamadas).toEqual([])
  })

  it('a recusa estoque_invalido do banco vira frase (defesa em profundidade)', async () => {
    mocks(() => ({ data: { ok: false, motivo: 'estoque_invalido' }, error: null }))
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await registrarEntradaAlmoxarifado(BIPE)).toEqual({
      ok: false, erro: 'Estoque de destino inválido: escolha PA ou EINTER.',
    })
  })

  it('sem permissão: recusa antes de qualquer outra coisa', async () => {
    EINTER_ENV()
    const chamadas = mocks(() => ({ data: {}, error: null }), SESSAO_SEM)
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await registrarEntradaAlmoxarifado({ ...BIPE, estoque: 'EINTER' })).toEqual({
      ok: false, erro: 'Você não tem permissão para esta ação.',
    })
    expect(chamadas).toEqual([])
  })
})

describe('confirmarLoteAlmoxarifado — estoque de destino', () => {
  it('sem escolha: sem p_estoque, responde PA', async () => {
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 2, lote: 'LOTE[ab][2]' }, error: null }))
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await confirmarLoteAlmoxarifado(LOTE)).toEqual({ ok: true, quantidade: 2, lote: 'LOTE[ab][2]', estoque: 'PA' })
    expect(chamadas[0]!.args).not.toHaveProperty('p_estoque')
  })

  it('EINTER configurado: manda p_estoque e responde EINTER', async () => {
    EINTER_ENV()
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 2, lote: 'LOTE[ab][2]' }, error: null }))
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await confirmarLoteAlmoxarifado({ ...LOTE, estoque: 'EINTER' })).toMatchObject({ ok: true, estoque: 'EINTER' })
    expect(chamadas[0]!.args).toMatchObject({ p_estoque: 'EINTER' })
  })

  it('EINTER sem configuração e valor inválido: recusados sem tocar o banco', async () => {
    const chamadas = mocks(() => ({ data: { ok: true, quantidade: 2 }, error: null }))
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')
    expect((await confirmarLoteAlmoxarifado({ ...LOTE, estoque: 'EINTER' })).ok).toBe(false)
    expect((await confirmarLoteAlmoxarifado({ ...LOTE, estoque: 'XYZ' })).ok).toBe(false)
    expect(chamadas).toEqual([])
  })
})

describe('estoqueDestinoDaOp', () => {
  it('EINTER indisponível: só PA, e nem consulta o banco', async () => {
    const chamadas = mocks(() => ({ data: 'EINTER', error: null }))
    const { estoqueDestinoDaOp } = await import('../almoxarifado-actions')
    expect(await estoqueDestinoDaOp('PMOC14', '8498')).toEqual({ ok: true, einterDisponivel: false, padrao: 'PA' })
    expect(chamadas).toEqual([])
  })

  it('EINTER disponível: o padrão é o último estoque da OP', async () => {
    EINTER_ENV()
    const chamadas = mocks(() => ({ data: 'EINTER', error: null }))
    const { estoqueDestinoDaOp } = await import('../almoxarifado-actions')
    expect(await estoqueDestinoDaOp('PMOC14', '8498')).toEqual({ ok: true, einterDisponivel: true, padrao: 'EINTER' })
    expect(chamadas).toEqual([{ nome: 'sf_estoque_ultimo_da_op', args: { p_pmo: 'PMOC14', p_op: '8498' } }])
  })

  it('resposta estranha do banco vira PA; sem OP no cabeçalho nem consulta', async () => {
    EINTER_ENV()
    const chamadas = mocks(() => ({ data: 'OUTRO', error: null }))
    const { estoqueDestinoDaOp } = await import('../almoxarifado-actions')
    expect(await estoqueDestinoDaOp('PMOC14', '8498')).toMatchObject({ padrao: 'PA' })
    chamadas.length = 0
    expect(await estoqueDestinoDaOp('', '')).toEqual({ ok: true, einterDisponivel: true, padrao: 'PA' })
    expect(chamadas).toEqual([])
  })

  it('falha do banco: padrão PA com AVISO (a pessoa ainda escolhe); sem permissão: recusa', async () => {
    EINTER_ENV()
    mocks(() => ({ data: null, error: { message: 'boom' } }))
    const { estoqueDestinoDaOp } = await import('../almoxarifado-actions')
    expect(await estoqueDestinoDaOp('PMOC14', '8498')).toMatchObject({ ok: true, einterDisponivel: true, padrao: 'PA' })
    expect((await estoqueDestinoDaOp('PMOC14', '8498') as { aviso?: string }).aviso).toContain('último estoque')

    vi.resetModules()
    mocks(() => ({ data: null, error: { message: 'SEM_PERMISSAO' } }))
    const outra = await import('../almoxarifado-actions')
    expect(await outra.estoqueDestinoDaOp('PMOC14', '8498')).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
  })

  it('sem permissão na sessão: recusa sem consultar', async () => {
    EINTER_ENV()
    const chamadas = mocks(() => ({ data: 'PA', error: null }), SESSAO_SEM)
    const { estoqueDestinoDaOp } = await import('../almoxarifado-actions')
    expect((await estoqueDestinoDaOp('PMOC14', '8498')).ok).toBe(false)
    expect(chamadas).toEqual([])
  })
})
