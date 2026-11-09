import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const PERFIL_OK = { recebimento: { lancar: true }, shopfloor: { visualizar: true } }

function mocks(opts: {
  porModulo?: Record<string, Record<string, boolean>>
  semSessao?: boolean
  rpcData?: unknown
  rpcError?: { message: string } | null
}) {
  const rpc = vi.fn(async () => ({ data: opts.rpcData ?? null, error: opts.rpcError ?? null }))
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () =>
      opts.semSessao
        ? null
        : { usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: { porModulo: opts.porModulo ?? PERFIL_OK, permissoes: {} } },
  }))
  vi.doMock('@/modules/shopfloor/infra/lancamento-repository', () => ({ carregarOrdem: async () => null }))
  vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }))
  return rpc
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/modules/shopfloor/infra/lancamento-repository')
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

const BASE = { qtd_op: 100, recebidas_op: 40, posto_anterior: { posto: 'NQA', recurso: 'R1', precisa_aprovado: true } }
const ARGS_CAIXA = { pmo: 'PMOT02', op: '9901', tipo: 'caixa' as const, codigo: 'CX[2][2]9901-PMOT02', loteId: null }
const ARGS_LOTE = { pmo: 'PMOL01', op: '9201', tipo: 'lote' as const, codigo: 'LOTE[abcd1234][5]', loteId: 'l1' }
const ERRO_CARGA = 'Não foi possível carregar os detalhes.'

describe('listarPendenciasAlmoxarifado (campos novos)', () => {
  it('devolve loteId e em', async () => {
    mocks({
      rpcData: [
        { pmo: 'P', op: '1', tipo: 'lote', codigo: 'L', pecas: 5, amostra: 2, lote_id: 'l1', em: '2026-10-21T13:42:00Z' },
        { pmo: 'P', op: '1', tipo: 'caixa', codigo: 'C', pecas: 3, amostra: null },
      ],
    })
    const { listarPendenciasAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await listarPendenciasAlmoxarifado()
    expect(r).toEqual({
      ok: true,
      pendencias: [
        { pmo: 'P', op: '1', tipo: 'lote', codigo: 'L', pecas: 5, amostra: 2, loteId: 'l1', em: '2026-10-21T13:42:00Z' },
        { pmo: 'P', op: '1', tipo: 'caixa', codigo: 'C', pecas: 3, amostra: null, loteId: null, em: null },
      ],
    })
  })
})

describe('detalharPendenciaAlmoxarifado', () => {
  it('sem sessão ou sem permissão recusa', async () => {
    mocks({ semSessao: true })
    let { detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await detalharPendenciaAlmoxarifado(ARGS_CAIXA)).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })

    vi.resetModules()
    mocks({ porModulo: { recebimento: { lancar: true }, shopfloor: { visualizar: false } } })
    ;({ detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions'))
    expect(await detalharPendenciaAlmoxarifado(ARGS_CAIXA)).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
  })

  it('converte o detalhe de caixa e chama a RPC', async () => {
    const rpc = mocks({
      rpcData: { ok: true, ...BASE, tipo: 'caixa', codigo: 'CX', pecas: 2, sns: ['1', '2'], fechada_em: '2026-10-21T13:00:00Z', fechada_por: 'Ana' },
    })
    const { detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await detalharPendenciaAlmoxarifado(ARGS_CAIXA)
    expect(rpc).toHaveBeenCalledWith('sf_almox_detalhe', { p_pmo: 'PMOT02', p_op: '9901', p_codigo: 'CX[2][2]9901-PMOT02', p_lote_id: null })
    expect(r).toEqual({
      ok: true,
      detalhe: {
        tipo: 'caixa', qtdOp: 100, recebidasOp: 40,
        postoAnterior: { posto: 'NQA', recurso: 'R1', precisaAprovado: true },
        pecas: 2, sns: ['1', '2'], em: '2026-10-21T13:00:00Z', fechadaPor: 'Ana', amostra: null, jaLancadas: 0,
      },
    })
  })

  it('converte o detalhe de lote', async () => {
    const rpc = mocks({
      rpcData: { ok: true, ...BASE, posto_anterior: null, qtd_op: null, tipo: 'lote', rotulo: 'R', pecas: 5, amostra: 2, sns: ['1'], aprovado_em: '2026-10-21T12:00:00Z', ja_lancadas: 1 },
    })
    const { detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await detalharPendenciaAlmoxarifado(ARGS_LOTE)
    expect(rpc).toHaveBeenCalledWith('sf_almox_detalhe', { p_pmo: 'PMOL01', p_op: '9201', p_codigo: 'LOTE[abcd1234][5]', p_lote_id: 'l1' })
    expect(r).toEqual({
      ok: true,
      detalhe: {
        tipo: 'lote', qtdOp: null, recebidasOp: 40, postoAnterior: null,
        pecas: 5, sns: ['1'], em: '2026-10-21T12:00:00Z', fechadaPor: null, amostra: 2, jaLancadas: 1,
      },
    })
  })

  it.each([
    ['op_inexistente', 'OP não encontrada.'],
    ['sem_almoxarifado', 'Esta OP não passa pelo Almoxarifado.'],
    ['item_inexistente', 'Esta caixa ou lote não está mais esperando confirmação. Atualize a lista.'],
  ])('ok:false %s vira frase em PT-BR', async (motivo, frase) => {
    mocks({ rpcData: { ok: false, motivo } })
    const { detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await detalharPendenciaAlmoxarifado(ARGS_CAIXA)).toEqual({ ok: false, erro: frase })
  })

  it('erro de RPC e resposta que não é objeto viram o erro de carga', async () => {
    mocks({ rpcError: { message: 'connection reset' } })
    let { detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await detalharPendenciaAlmoxarifado(ARGS_CAIXA)).toEqual({ ok: false, erro: ERRO_CARGA })

    vi.resetModules()
    mocks({ rpcData: 'lixo' })
    ;({ detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions'))
    expect(await detalharPendenciaAlmoxarifado(ARGS_CAIXA)).toEqual({ ok: false, erro: ERRO_CARGA })

    vi.resetModules()
    mocks({ rpcData: null })
    ;({ detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions'))
    expect(await detalharPendenciaAlmoxarifado(ARGS_CAIXA)).toEqual({ ok: false, erro: ERRO_CARGA })
  })

  it('SEM_PERMISSAO do RPC vira a frase de permissão', async () => {
    mocks({ rpcError: { message: 'SEM_PERMISSAO' } })
    const { detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await detalharPendenciaAlmoxarifado(ARGS_CAIXA)).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
  })
})

describe('peças avulsas (tipo peca)', () => {
  it('lista: converte a linha AVULSAS como tipo peca', async () => {
    mocks({
      rpcData: [
        { pmo: 'P', op: '1', tipo: 'peca', codigo: 'AVULSAS', pecas: 7, amostra: null, lote_id: null, em: '2026-10-21T13:42:00Z', seq: null, ja_lancadas: 0 },
      ],
    })
    const { listarPendenciasAlmoxarifado } = await import('../almoxarifado-actions')
    expect(await listarPendenciasAlmoxarifado()).toEqual({
      ok: true,
      pendencias: [
        { pmo: 'P', op: '1', tipo: 'peca', codigo: 'AVULSAS', pecas: 7, amostra: null, loteId: null, em: '2026-10-21T13:42:00Z' },
      ],
    })
  })

  it('detalhe: converte tipo peca, sns vazio e a hora de em', async () => {
    const rpc = mocks({
      rpcData: { ok: true, tipo: 'peca', ...BASE, pecas: 7, em: '2026-10-21T13:42:00Z' },
    })
    const { detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await detalharPendenciaAlmoxarifado({ pmo: 'P', op: '1', tipo: 'peca', codigo: 'AVULSAS', loteId: null })
    expect(rpc).toHaveBeenCalledWith('sf_almox_detalhe', { p_pmo: 'P', p_op: '1', p_codigo: 'AVULSAS', p_lote_id: null })
    expect(r).toEqual({
      ok: true,
      detalhe: {
        tipo: 'peca', qtdOp: 100, recebidasOp: 40,
        postoAnterior: { posto: 'NQA', recurso: 'R1', precisaAprovado: true },
        pecas: 7, sns: [], em: '2026-10-21T13:42:00Z', fechadaPor: null, amostra: null, jaLancadas: 0,
      },
    })
  })
})
