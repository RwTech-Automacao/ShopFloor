import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const PERFIL_OK = { recebimento: { lancar: true }, shopfloor: { visualizar: true } }

function mocks(opts: {
  porModulo?: Record<string, Record<string, boolean>>
  rpcData?: unknown
  rpcError?: { message: string } | null
  ordem?: Record<string, unknown> | null
}) {
  const rpc = vi.fn(async () => ({ data: opts.rpcData ?? null, error: opts.rpcError ?? null }))
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({
      usuarioId: 'u1', nome: 'Ana', email: 'ana@x',
      perfil: { porModulo: opts.porModulo ?? PERFIL_OK, permissoes: {} },
    }),
  }))
  vi.doMock('@/modules/shopfloor/infra/lancamento-repository', () => ({
    carregarOrdem: async () => (opts.ordem === undefined ? { embalagem_individual: true } : opts.ordem),
  }))
  vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }))
  return rpc
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/modules/shopfloor/infra/lancamento-repository')
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

const LINHA = {
  lote_id: 'l1', rotulo: 'LOTE[abcd1234][5]', pecas: 5, amostra: 2,
  sns: ['7001', '7002', '7003', '7004', '7005'], ja_lancadas: 0, aprovado_em: '2026-10-20T12:00:00Z',
}

describe('listarLotesAlmoxarifado (0156)', () => {
  it('devolve os lotes tipados (camelCase) e chama a RPC com a OP', async () => {
    const rpc = mocks({ rpcData: [LINHA, { ...LINHA, lote_id: 'l2', amostra: null, ja_lancadas: 1, aprovado_em: null }] })
    const { listarLotesAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await listarLotesAlmoxarifado(' PMOL01 ', '9201')

    expect(rpc).toHaveBeenCalledWith('sf_almox_lotes', { p_pmo: 'PMOL01', p_op: '9201' })
    expect(r).toEqual({
      ok: true,
      lotes: [
        { loteId: 'l1', rotulo: 'LOTE[abcd1234][5]', pecas: 5, amostra: 2, sns: LINHA.sns, jaLancadas: 0, aprovadoEm: '2026-10-20T12:00:00Z' },
        { loteId: 'l2', rotulo: 'LOTE[abcd1234][5]', pecas: 5, amostra: null, sns: LINHA.sns, jaLancadas: 1, aprovadoEm: null },
      ],
    })
  })

  it('erro do banco vira estado de erro — nunca lista vazia no lugar da falha', async () => {
    mocks({ rpcError: { message: 'connection reset' } })
    const { listarLotesAlmoxarifado } = await import('../almoxarifado-actions')

    expect(await listarLotesAlmoxarifado('PMOL01', '9201')).toEqual({
      ok: false, erro: 'Não foi possível carregar os lotes esperando confirmação.',
    })
  })

  it('resposta que não é lista é falha', async () => {
    mocks({ rpcData: null })
    const { listarLotesAlmoxarifado } = await import('../almoxarifado-actions')
    expect((await listarLotesAlmoxarifado('PMOL01', '9201')).ok).toBe(false)
  })

  it('SEM_PERMISSAO do banco vira a frase de permissão', async () => {
    mocks({ rpcError: { message: 'SEM_PERMISSAO' } })
    const { listarLotesAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await listarLotesAlmoxarifado('PMOL01', '9201')).toEqual({
      ok: false, erro: 'Você não tem permissão para esta ação.',
    })
  })

  it('sem recebimento.lancar ou sem shopfloor.visualizar: recusa antes do banco', async () => {
    let rpc = mocks({ porModulo: { shopfloor: { visualizar: true } } })
    let mod = await import('../almoxarifado-actions')
    expect((await mod.listarLotesAlmoxarifado('PMOL01', '9201')).ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
    vi.resetModules()
    rpc = mocks({ porModulo: { recebimento: { lancar: true } } })
    mod = await import('../almoxarifado-actions')
    expect((await mod.listarLotesAlmoxarifado('PMOL01', '9201')).ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sem OP: lista vazia sem round-trip', async () => {
    const rpc = mocks({})
    const { listarLotesAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await listarLotesAlmoxarifado('', '')).toEqual({ ok: true, lotes: [] })
    expect(rpc).not.toHaveBeenCalled()
  })
})

const CONF = {
  pmo: 'PMOL01', op: '9201', posto: 'Almoxarifado', colaborador: 'Ana', loteId: 'l1',
  amostra: ['0007-001', '7003', '7003'],
}

describe('confirmarLoteAlmoxarifado (0156)', () => {
  it('manda os SNs NORMALIZADOS e sem repetido, e devolve as peças e o rótulo', async () => {
    const rpc = mocks({ rpcData: { ok: true, quantidade: 5, lote: 'LOTE[abcd1234][5]' } })
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await confirmarLoteAlmoxarifado(CONF)

    expect(rpc).toHaveBeenCalledWith('sf_almoxarifado_lote', {
      p_pmo: 'PMOL01', p_op: '9201', p_posto: 'Almoxarifado', p_colaborador: 'Ana',
      p_lote_id: 'l1', p_amostra: ['7001', '7003'],
    })
    expect(r).toEqual({ ok: true, quantidade: 5, lote: 'LOTE[abcd1234][5]' })
  })

  it('recusa da RPC vira a frase (o detalhe pronto vale)', async () => {
    mocks({ rpcData: { ok: false, motivo: 'amostra_fora_do_lote', detalhe: 'A peça 7099 não é deste lote.' } })
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await confirmarLoteAlmoxarifado(CONF)).toEqual({ ok: false, erro: 'A peça 7099 não é deste lote.' })
  })

  it('erro do banco vira mensagem, nunca sucesso', async () => {
    mocks({ rpcError: { message: 'boom' } })
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await confirmarLoteAlmoxarifado(CONF)).toEqual({ ok: false, erro: 'Não foi possível confirmar o lote.' })
  })

  it('sem recebimento.lancar: recusa antes do banco', async () => {
    const rpc = mocks({ porModulo: { shopfloor: { visualizar: true } } })
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await confirmarLoteAlmoxarifado(CONF)).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sem colaborador/OP/posto/lote: recusa antes do banco', async () => {
    const rpc = mocks({})
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')
    expect((await confirmarLoteAlmoxarifado({ ...CONF, colaborador: ' ' })).ok).toBe(false)
    expect((await confirmarLoteAlmoxarifado({ ...CONF, loteId: '' })).ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('registrarEntradaAlmoxarifado — serie_exige_lote (0156)', () => {
  it('o bipe avulso na OP individual com NQA no anterior mostra a frase do lote', async () => {
    mocks({
      rpcData: {
        ok: false, motivo: 'serie_exige_lote', posto_anterior: 'Inspeção NQA',
        detalhe: 'Esta peça faz parte de um lote do NQA: confirme o lote inteiro.',
      },
    })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await registrarEntradaAlmoxarifado({
      pmo: 'PMOL01', op: '9201', posto: 'Almoxarifado', colaborador: 'Ana', bipe: '7012',
    })

    expect(r).toEqual({ ok: false, erro: 'Esta peça faz parte de um lote do NQA: confirme o lote inteiro.' })
  })
})
