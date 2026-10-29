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
    carregarOrdem: async () => (opts.ordem === undefined ? { embalagem_individual: false } : opts.ordem),
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

describe('listarNecessidadesAlmoxarifado', () => {
  it('devolve a lista tipada (camelCase) e chama a RPC com a OP', async () => {
    const rpc = mocks({
      rpcData: [
        { codigo: 'CX[1][3]9116-PMON16', seq: 1, pecas: 3, fechada_em: '2026-10-20T12:00:00Z' },
        { codigo: 'CX[4][2]9116-PMON16', seq: 4, pecas: 2, fechada_em: null },
      ],
    })
    const { listarNecessidadesAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await listarNecessidadesAlmoxarifado(' PMON16 ', '9116')

    expect(rpc).toHaveBeenCalledWith('sf_almox_necessidades', { p_pmo: 'PMON16', p_op: '9116' })
    expect(r).toEqual({
      ok: true,
      necessidades: [
        { codigo: 'CX[1][3]9116-PMON16', seq: 1, pecas: 3, fechadaEm: '2026-10-20T12:00:00Z' },
        { codigo: 'CX[4][2]9116-PMON16', seq: 4, pecas: 2, fechadaEm: null },
      ],
    })
  })

  it('erro do banco vira mensagem — nunca lista vazia no lugar da falha', async () => {
    mocks({ rpcError: { message: 'connection reset' } })
    const { listarNecessidadesAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await listarNecessidadesAlmoxarifado('PMON16', '9116')

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('esperado ok:false')
    expect(r.erro).toBe('Não foi possível carregar as caixas esperando confirmação.')
  })

  it('SEM_PERMISSAO do banco vira a frase de permissão', async () => {
    mocks({ rpcError: { message: 'SEM_PERMISSAO' } })
    const { listarNecessidadesAlmoxarifado } = await import('../almoxarifado-actions')

    expect(await listarNecessidadesAlmoxarifado('PMON16', '9116')).toEqual({
      ok: false, erro: 'Você não tem permissão para esta ação.',
    })
  })

  it('sem recebimento.lancar: recusa antes de falar com o banco', async () => {
    const rpc = mocks({ porModulo: { shopfloor: { visualizar: true } } })
    const { listarNecessidadesAlmoxarifado } = await import('../almoxarifado-actions')

    expect(await listarNecessidadesAlmoxarifado('PMON16', '9116')).toEqual({
      ok: false, erro: 'Você não tem permissão para esta ação.',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sem shopfloor.visualizar: recusa antes de falar com o banco', async () => {
    const rpc = mocks({ porModulo: { recebimento: { lancar: true } } })
    const { listarNecessidadesAlmoxarifado } = await import('../almoxarifado-actions')

    expect((await listarNecessidadesAlmoxarifado('PMON16', '9116')).ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sem OP escolhida ainda: lista vazia sem round-trip (não há o que perguntar)', async () => {
    const rpc = mocks({})
    const { listarNecessidadesAlmoxarifado } = await import('../almoxarifado-actions')

    expect(await listarNecessidadesAlmoxarifado('', '')).toEqual({ ok: true, necessidades: [] })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('resposta que não é lista é tratada como falha, não como lista vazia', async () => {
    mocks({ rpcData: null })
    const { listarNecessidadesAlmoxarifado } = await import('../almoxarifado-actions')

    expect((await listarNecessidadesAlmoxarifado('PMON16', '9116')).ok).toBe(false)
  })
})

describe('registrarEntradaAlmoxarifado — posto anterior não concluído (0155)', () => {
  it('peça: a frase diz o posto anterior e que precisa estar aprovada', async () => {
    mocks({
      ordem: { embalagem_individual: true },
      rpcData: {
        ok: false, motivo: 'posto_anterior_nao_concluido', posto_anterior: 'Inspeção Final', precisa_aprovado: true,
        detalhe: 'A peça 5002 ainda não foi aprovada no posto anterior (Inspeção Final).',
      },
    })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await registrarEntradaAlmoxarifado({
      pmo: 'PMON01', op: '9101', posto: 'Almoxarifado', colaborador: 'Ana', bipe: '5002',
    })

    expect(r).toEqual({
      ok: false,
      erro: 'Esta peça ainda não foi aprovada no posto anterior (Inspeção Final). Aprove a peça lá antes de dar entrada.',
    })
  })

  it('caixa: a frase diz o posto anterior e que todas as peças precisam estar registradas', async () => {
    mocks({
      rpcData: {
        ok: false, motivo: 'posto_anterior_nao_concluido', posto_anterior: 'Inspeção Final', precisa_aprovado: false,
      },
    })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await registrarEntradaAlmoxarifado({
      pmo: 'PMON14', op: '9114', posto: 'Almoxarifado', colaborador: 'Ana', bipe: 'CX[2][2]9114-PMON14',
    })

    expect(r).toEqual({
      ok: false,
      erro: 'Esta caixa ainda não foi concluída no posto anterior (Inspeção Final): todas as peças precisam estar registradas lá.',
    })
  })

  it('sem posto_anterior no jsonb: cai no detalhe da RPC', async () => {
    mocks({ rpcData: { ok: false, motivo: 'posto_anterior_nao_concluido', detalhe: 'Frase da RPC.' } })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await registrarEntradaAlmoxarifado({
      pmo: 'PMON14', op: '9114', posto: 'Almoxarifado', colaborador: 'Ana', bipe: 'CX[2][2]9114-PMON14',
    })

    expect(r).toEqual({ ok: false, erro: 'Frase da RPC.' })
  })
})
