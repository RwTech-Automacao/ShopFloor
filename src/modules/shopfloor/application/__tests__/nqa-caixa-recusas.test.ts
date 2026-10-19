import { afterEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSAO_OK = {
  usuarioId: 'u1', nome: 'Qualidade', email: 'qa@x',
  perfil: { porModulo: { shopfloor: { lancar: true } }, permissoes: {} },
}

/**
 * A sf_nqa_caixa recusa por EXCEÇÃO (`raise exception 'CODIGO'`), então quem chama só tem
 * `error.message` — o supabase-js devolve a mensagem do Postgres com prefixo. É por isso que a
 * action casa por `includes` e não por igualdade.
 */
function mocks(mensagem: string) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => SESSAO_OK }))
  vi.doMock('@/shared/lib/supabase/server', () => ({
    createServerSupabase: async () => ({
      rpc: async () => ({ data: null, error: { message: mensagem } }),
    }),
  }))
}

const ENTRADA = {
  colaborador: 'Qualidade',
  pmo: 'PMOC22',
  op: '8506',
  posto: 'Inspeção NQA',
  numeroCaixa: 'CX[1][3]8506-PMOC22',
  amostras: [{ snNorm: '9901', visual: 'Reprovado', funcional: 'Aprovado', observacao: 'riscada' }],
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

describe('finalizarNqaCaixa — recusa de caixa que já deu entrada no Almoxarifado', () => {
  it('a recusa nova tem frase própria, com o que fazer e onde', async () => {
    // Sem o `case` do código, esta recusa cairia no `default` ("Não foi possível registrar o NQA da
    // caixa.") e o inspetor perderia justamente a instrução — e aqui a saída está em OUTRA tela,
    // com OUTRA pessoa: é o gestor que cancela a entrada em Registros.
    mocks('erro: CAIXA_JA_NO_ALMOXARIFADO')
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')

    const r = await finalizarNqaCaixa({ ...ENTRADA, resultado: 'Reprovado', postosRetorno: ['Embalagem'] })

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('esperado ok:false')
    expect(r.erro).toContain('Almoxarifado')
    expect(r.erro).toContain('Cancelar a caixa inteira')
    expect(r.erro).not.toContain('Não foi possível')
  })

  it('a mesma frase no Aprovado: a RPC recusa os dois resultados', async () => {
    mocks('erro: CAIXA_JA_NO_ALMOXARIFADO')
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')

    const r = await finalizarNqaCaixa({ ...ENTRADA, resultado: 'Aprovado' })

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('esperado ok:false')
    expect(r.erro).toContain('Cancelar a caixa inteira')
  })

  it('a recusa antiga não foi engolida pela nova (as duas começam com CAIXA_JA_)', async () => {
    mocks('erro: CAIXA_JA_INSPECIONADA')
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')

    const r = await finalizarNqaCaixa({ ...ENTRADA, resultado: 'Reprovado', postosRetorno: ['Embalagem'] })

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('esperado ok:false')
    expect(r.erro).toBe('Esta caixa já foi inspecionada no NQA.')
  })
})
