import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Placas por painel (0165): o Almoxarifado mostra e envia o que a RPC devolve, em PLACAS — nunca um `1`
// fixo da peça nem a contagem de SNs. O que é painel (SN a bipar) vem em campo próprio.

const PERFIL_OK = { recebimento: { lancar: true }, shopfloor: { visualizar: true } }

function mocks(rpcData: unknown, embalagemIndividual = true) {
  const rpc = vi.fn(async () => ({ data: rpcData, error: null }))
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', nome: 'Ana', email: 'ana@x', perfil: { porModulo: PERFIL_OK, permissoes: {} } }),
  }))
  vi.doMock('@/modules/shopfloor/infra/lancamento-repository', () => ({
    carregarOrdem: async () => ({ embalagem_individual: embalagemIndividual }),
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

describe('Almoxarifado em placas por painel', () => {
  it('peça avulsa de um painel de 50 placas: a quantidade é a da RPC (50), não o 1 do domínio', async () => {
    mocks({ ok: true, quantidade: 50 })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await registrarEntradaAlmoxarifado({ pmo: 'PMOZ03', op: '9603', posto: 'Almoxarifado', colaborador: 'Ana', bipe: '9701' })
    expect(r).toEqual({ ok: true, quantidade: 50, tipo: 'serie', divergencia: undefined })
  })

  it('caixa CX[1][500] com 10 painéis: 500 entraram, sem divergência', async () => {
    mocks({ ok: true, quantidade: 500 }, false)
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await registrarEntradaAlmoxarifado({
      pmo: 'PMOZ01', op: '9601', posto: 'Almoxarifado', colaborador: 'Ana', bipe: 'CX[1][500]9601-PMOZ01',
    })
    expect(r).toEqual({ ok: true, quantidade: 500, tipo: 'caixa', divergencia: undefined })
  })

  it('lote de 4 painéis: a confirmação devolve as placas (200)', async () => {
    mocks({ ok: true, quantidade: 200, lote: 'LOTE[abcd1234][4]' })
    const { confirmarLoteAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await confirmarLoteAlmoxarifado({
      pmo: 'PMOZ04', op: '9604', posto: 'Almoxarifado', colaborador: 'Ana', loteId: 'l1', amostra: ['9801', '9802', '9803', '9804'],
    })
    expect(r).toEqual({ ok: true, quantidade: 200, lote: 'LOTE[abcd1234][4]' })
  })

  it('detalhe das peças avulsas: pecas em placas e `paineis` = SNs esperando', async () => {
    mocks({
      ok: true, tipo: 'peca', qtd_op: 2000, recebidas_op: 50, posto_anterior: null,
      pecas: 150, paineis: 3, sns: ['9701', '9702', '9703'], em: '2026-10-27T10:00:00Z',
    })
    const { detalharPendenciaAlmoxarifado } = await import('../almoxarifado-actions')
    const r = await detalharPendenciaAlmoxarifado({ pmo: 'PMOZ03', op: '9603', tipo: 'peca', codigo: 'AVULSAS', loteId: null })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('esperado ok')
    expect(r.detalhe.pecas).toBe(150)
    expect(r.detalhe.paineis).toBe(3)
    expect(r.detalhe.recebidasOp).toBe(50)
  })
})
