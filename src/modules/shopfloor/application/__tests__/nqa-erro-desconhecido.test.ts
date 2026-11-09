import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const SESSAO_OK = {
  usuarioId: 'u1', nome: 'Qualidade', email: 'qa@x',
  perfil: { porModulo: { shopfloor: { lancar: true } }, permissoes: {} },
}

type Cenario = {
  rpc: 'erro-desconhecido' | 'excecao' | { message: string }
  /** SNs que a leitura de verificação devolve; 'erro' = a leitura falha */
  gravados: string[] | 'erro'
  /** `pecas` das linhas devolvidas (placas por painel); omitido = linha sem a coluna (vale 1) */
  pecas?: number
}

/** Mock do cliente: rpc + cadeia from().select().eq()...in().gte() que registra os filtros usados. */
function mocks(c: Cenario) {
  const filtros: Record<string, unknown> = {}
  const leituras = { n: 0 }
  vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => SESSAO_OK }))
  vi.doMock('@/shared/lib/supabase/server', () => ({
    createServerSupabase: async () => ({
      rpc: async () => {
        if (c.rpc === 'excecao') throw new Error('fetch failed')
        if (c.rpc === 'erro-desconhecido') return { data: null, error: { message: 'gateway timeout 504', code: '57014' } }
        return { data: null, error: c.rpc }
      },
      from: (t: string) => {
        filtros.tabela = t
        leituras.n++
        const b: Record<string, unknown> = {}
        b.select = () => b
        b.eq = (col: string, v: unknown) => { filtros[col] = v; return b }
        b.in = (col: string, v: unknown) => { filtros[`in:${col}`] = v; return b }
        b.gte = (col: string, v: unknown) => { filtros[`gte:${col}`] = v; return b }
        b.then = (res: (x: unknown) => unknown) =>
          res(c.gravados === 'erro'
            ? { data: null, error: { message: 'falha leitura' } }
            : { data: c.gravados.map((s) => (c.pecas === undefined ? { numero_serie_norm: s } : { numero_serie_norm: s, pecas: c.pecas })), error: null })
        return b
      },
    }),
  }))
  return { filtros, leituras }
}

const CAIXA = {
  colaborador: 'Qualidade', pmo: 'PMOC22', op: '8506', posto: 'Inspeção NQA',
  numeroCaixa: 'CX[1][3]8506-PMOC22',
  amostras: [
    { snNorm: '9901', visual: 'Aprovado', funcional: 'Aprovado', observacao: '' },
    { snNorm: '9902', visual: 'Aprovado', funcional: 'Aprovado', observacao: '' },
  ],
}
const LOTE = {
  colaborador: 'Qualidade', pmo: 'PMOC22', op: '8506', posto: 'Inspeção NQA',
  snsNorm: ['9901', '9902', '9903'],
  amostras: [{ snNorm: '9901', visual: 'Aprovado', funcional: 'Aprovado', observacao: '' }],
}
const TXT_CAIXA = 'Não foi possível registrar o NQA da caixa. Confira em Consultar Caixa antes de tentar de novo.'
const TXT_LOTE = 'Não foi possível registrar o NQA do lote. Confira antes de tentar de novo.'

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => {
  errSpy.mockRestore()
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

const logs = () => errSpy.mock.calls.map((a: unknown[]) => a.join(' ')).join('\n')

describe('finalizarNqaCaixa — erro que não é recusa de negócio', () => {
  it('recusa conhecida mantém a frase e não consulta a verificação', async () => {
    const { leituras } = mocks({ rpc: { message: 'erro: CAIXA_VAZIA' }, gravados: [] })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: 'Caixa sem peças.' })
    expect(leituras.n).toBe(0)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('SEM_PERMISSAO do banco vira a frase de permissão, sem verificação', async () => {
    const { leituras } = mocks({ rpc: { message: 'SEM_PERMISSAO' }, gravados: [] })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    expect(leituras.n).toBe(0)
  })

  it('erro desconhecido sem gravação: loga, verifica e devolve o texto único', async () => {
    const { filtros } = mocks({ rpc: 'erro-desconhecido', gravados: [] })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: TXT_CAIXA })
    expect(logs()).toContain('[nqa-caixa]')
    expect(logs()).toContain('gateway timeout 504')
    expect(logs()).toContain('PMOC22')
    expect(logs()).toContain('CX[1][3]8506-PMOC22')
    expect(filtros.tabela).toBe('sf_registros')
    expect(filtros.posto).toBe('Inspeção NQA')
    expect(filtros.pmo).toBe('PMOC22')
    expect(filtros.op).toBe('8506')
    expect(filtros['in:numero_serie_norm']).toEqual(['9901', '9902'])
    expect(typeof filtros['gte:data_hora']).toBe('string')
  })

  it('erro desconhecido COM gravação confirmada vira sucesso e loga', async () => {
    mocks({ rpc: 'erro-desconhecido', gravados: ['9901', '9902'] })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: true, total: 2 })
    expect(logs()).toContain('resposta perdida mas gravado; tratado como sucesso')
  })

  it('gravação parcial (falta SN) não é sucesso', async () => {
    mocks({ rpc: 'erro-desconhecido', gravados: ['9901'] })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: TXT_CAIXA })
  })

  it('exceção de rede sem gravação: loga e devolve o texto único', async () => {
    mocks({ rpc: 'excecao', gravados: [] })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: TXT_CAIXA })
    expect(logs()).toContain('[nqa-caixa]')
    expect(logs()).toContain('fetch failed')
  })

  it('exceção de rede COM gravação confirmada vira sucesso', async () => {
    mocks({ rpc: 'excecao', gravados: ['9901', '9902'] })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: true, total: 2 })
  })

  it('placas por painel: o total recuperado soma as placas dos SNs confirmados (uma vez por SN)', async () => {
    mocks({ rpc: 'erro-desconhecido', gravados: ['9901', '9902', '9901'], pecas: 50 })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: true, total: 100 })
  })

  it('a verificação falhando devolve o erro, nunca sucesso', async () => {
    mocks({ rpc: 'excecao', gravados: 'erro' })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    const r = await finalizarNqaCaixa({ ...CAIXA, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: TXT_CAIXA })
  })

  it('Reprovado verifica com status = Reprovado', async () => {
    const { filtros } = mocks({ rpc: 'erro-desconhecido', gravados: [] })
    const { finalizarNqaCaixa } = await import('../nqa-caixa-actions')
    await finalizarNqaCaixa({ ...CAIXA, resultado: 'Reprovado', postosRetorno: ['Embalagem'] })
    expect(filtros.status).toBe('Reprovado')
  })
})

describe('finalizarNqaIndividual — erro que não é recusa de negócio', () => {
  it('recusa conhecida mantém a frase e não consulta a verificação', async () => {
    const { leituras } = mocks({ rpc: { message: 'erro: LOTE_VAZIO' }, gravados: [] })
    const { finalizarNqaIndividual } = await import('../nqa-individual-actions')
    const r = await finalizarNqaIndividual({ ...LOTE, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: 'Lote sem peças.' })
    expect(leituras.n).toBe(0)
  })

  it('SEM_PERMISSAO do banco vira a frase de permissão', async () => {
    const { leituras } = mocks({ rpc: { message: 'SEM_PERMISSAO' }, gravados: [] })
    const { finalizarNqaIndividual } = await import('../nqa-individual-actions')
    const r = await finalizarNqaIndividual({ ...LOTE, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    expect(leituras.n).toBe(0)
  })

  it('erro desconhecido sem gravação: loga, verifica pelos SNs do lote e devolve o texto único', async () => {
    const { filtros } = mocks({ rpc: 'erro-desconhecido', gravados: ['9901'] })
    const { finalizarNqaIndividual } = await import('../nqa-individual-actions')
    const r = await finalizarNqaIndividual({ ...LOTE, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: TXT_LOTE })
    expect(logs()).toContain('[nqa-lote]')
    expect(logs()).toContain('gateway timeout 504')
    expect(filtros['in:numero_serie_norm']).toEqual(['9901', '9902', '9903'])
    expect(filtros.posto).toBe('Inspeção NQA')
  })

  it('erro desconhecido COM gravação confirmada vira sucesso com o total do lote', async () => {
    mocks({ rpc: 'erro-desconhecido', gravados: ['9901', '9902', '9903'] })
    const { finalizarNqaIndividual } = await import('../nqa-individual-actions')
    const r = await finalizarNqaIndividual({ ...LOTE, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: true, total: 3 })
    expect(logs()).toContain('[nqa-lote] resposta perdida mas gravado; tratado como sucesso')
  })

  it('exceção de rede com e sem gravação', async () => {
    mocks({ rpc: 'excecao', gravados: [] })
    let m = await import('../nqa-individual-actions')
    expect(await m.finalizarNqaIndividual({ ...LOTE, resultado: 'Aprovado' })).toEqual({ ok: false, erro: TXT_LOTE })
    vi.resetModules()
    mocks({ rpc: 'excecao', gravados: ['9901', '9902', '9903'] })
    m = await import('../nqa-individual-actions')
    expect(await m.finalizarNqaIndividual({ ...LOTE, resultado: 'Aprovado' })).toEqual({ ok: true, total: 3 })
  })

  it('placas por painel: o total recuperado do lote é em placas (3 painéis × 50 = 150)', async () => {
    mocks({ rpc: 'erro-desconhecido', gravados: ['9901', '9902', '9903'], pecas: 50 })
    const { finalizarNqaIndividual } = await import('../nqa-individual-actions')
    const r = await finalizarNqaIndividual({ ...LOTE, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: true, total: 150 })
  })

  it('a verificação falhando devolve o erro', async () => {
    mocks({ rpc: 'erro-desconhecido', gravados: 'erro' })
    const { finalizarNqaIndividual } = await import('../nqa-individual-actions')
    const r = await finalizarNqaIndividual({ ...LOTE, resultado: 'Aprovado' })
    expect(r).toEqual({ ok: false, erro: TXT_LOTE })
  })

  it('Reprovado verifica com status = Reprovado', async () => {
    const { filtros } = mocks({ rpc: 'erro-desconhecido', gravados: [] })
    const { finalizarNqaIndividual } = await import('../nqa-individual-actions')
    await finalizarNqaIndividual({ ...LOTE, resultado: 'Reprovado', postosRetorno: ['Embalagem'] })
    expect(filtros.status).toBe('Reprovado')
  })
})
