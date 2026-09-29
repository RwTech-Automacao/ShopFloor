import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSAO_OK = {
  usuarioId: 'u1', nome: 'Ana', email: 'ana@x',
  perfil: { porModulo: { shopfloor: { lancar: true } }, permissoes: {} },
}

// OP coletiva: o bipe é o código da caixa.
const ORDEM_COLETIVA = { embalagem_individual: false }

function mocks(resposta: Record<string, unknown>) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => SESSAO_OK }))
  vi.doMock('@/modules/shopfloor/infra/lancamento-repository', () => ({
    carregarOrdem: async () => ORDEM_COLETIVA,
  }))
  vi.doMock('@/shared/lib/supabase/server', () => ({
    createServerSupabase: async () => ({ rpc: async () => ({ data: resposta, error: null }) }),
  }))
}

const BIPE = { pmo: 'PMOC14', op: '8498', posto: 'Almoxarifado', colaborador: 'Ana', bipe: 'CX[3][14]8498-PMOC14' }

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/modules/shopfloor/infra/lancamento-repository')
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

describe('registrarEntradaAlmoxarifado — etiqueta × contagem real', () => {
  it('etiqueta de 14 com 13 peças gravadas: a divergência vira frase pro painel', async () => {
    // `qtd_etiqueta` é o que a 0129 passou a devolver: antes, a diferença ficava só num
    // `raise warning` do Postgres, que o supabase-js engole — o painel dizia "13 peças" e ninguém
    // ficava sabendo que a etiqueta prometia 14.
    mocks({ ok: true, quantidade: 13, qtd_etiqueta: 14 })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await registrarEntradaAlmoxarifado(BIPE)

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('esperado ok:true')
    expect(r.quantidade).toBe(13)
    expect(r.divergencia).toBe('14 peças na etiqueta, 13 entraram.')
  })

  it('etiqueta e contagem batendo: nenhum aviso', async () => {
    mocks({ ok: true, quantidade: 14 })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await registrarEntradaAlmoxarifado(BIPE)

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('esperado ok:true')
    expect(r.quantidade).toBe(14)
    expect(r.divergencia).toBeUndefined()
  })

  it('caixa de 1 peça: o singular da etiqueta e do que entrou', async () => {
    mocks({ ok: true, quantidade: 1, qtd_etiqueta: 2 })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await registrarEntradaAlmoxarifado({ ...BIPE, bipe: 'CX[3][2]8498-PMOC14' })

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('esperado ok:true')
    expect(r.divergencia).toBe('2 peças na etiqueta, 1 entrou.')
  })

  it('recusa da RPC continua virando a frase da recusa, sem aviso de divergência', async () => {
    mocks({ ok: false, motivo: 'caixa_sem_pecas', detalhe: 'A caixa 11 não tem nenhuma peça registrada na Embalagem.' })
    const { registrarEntradaAlmoxarifado } = await import('../almoxarifado-actions')

    const r = await registrarEntradaAlmoxarifado(BIPE)

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('esperado ok:false')
    expect(r.erro).toBe('A caixa 11 não tem nenhuma peça registrada na Embalagem.')
  })
})
