import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSessao = vi.fn()
const registrarLog = vi.fn()
const revalidatePath = vi.fn()
const rpc = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog }))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }))

const { salvarJustificativaDivergencia } = await import('../justificar-divergencia')
const { LIMITE_JUSTIFICATIVA } = await import('../../domain/divergencia')

const sessaoCom = (administrar: boolean) => ({ perfil: { porModulo: { recebimento: { administrar } } } })
const ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue(sessaoCom(true))
  rpc.mockResolvedValue({ error: null })
})

describe('salvarJustificativaDivergencia', () => {
  it('sem sessão recusa, sem tocar no banco nem no log', async () => {
    getSessao.mockResolvedValue(null)
    expect(await salvarJustificativaDivergencia(ID, 'x')).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    expect(rpc).not.toHaveBeenCalled()
    expect(registrarLog).not.toHaveBeenCalled()
  })

  it('sem administrar recusa, sem tocar no banco nem no log', async () => {
    getSessao.mockResolvedValue(sessaoCom(false))
    expect(await salvarJustificativaDivergencia(ID, 'x')).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    expect(rpc).not.toHaveBeenCalled()
    expect(registrarLog).not.toHaveBeenCalled()
  })

  it('chama a RPC só com id e texto aparado (sem autor) e revalida', async () => {
    expect(await salvarJustificativaDivergencia(ID, '  Alinhado com o fornecedor  ')).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('rec_justificar_divergencia', { p_id: ID, p_texto: 'Alinhado com o fornecedor' })
    expect(revalidatePath).toHaveBeenCalledWith(`/recebimento/processos/${ID}`)
    expect(revalidatePath).toHaveBeenCalledWith('/recebimento/processos')
  })

  it("o log sai com acao 'alterar_campo', entidade processo e o texto", async () => {
    await salvarJustificativaDivergencia(ID, '  motivo  ')
    expect(registrarLog).toHaveBeenCalledTimes(1)
    expect(registrarLog).toHaveBeenCalledWith({
      entidade: 'processo',
      entidadeId: ID,
      acao: 'alterar_campo',
      descricao: 'Justificativa de divergência de quantidade: motivo',
      dados: { campo: 'divergencia_justificativa', valor: 'motivo' },
    })
  })

  it('SEM_PERMISSAO da função vira erro PT-BR, sem log nem revalidate', async () => {
    rpc.mockResolvedValue({ error: { message: 'SEM_PERMISSAO' } })
    expect(await salvarJustificativaDivergencia(ID, 'x')).toEqual({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    expect(registrarLog).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('PROCESSO_NAO_ENCONTRADO vira erro PT-BR, sem log', async () => {
    rpc.mockResolvedValue({ error: { message: 'PROCESSO_NAO_ENCONTRADO' } })
    expect(await salvarJustificativaDivergencia(ID, 'x')).toEqual({ ok: false, erro: 'Processo não encontrado.' })
    expect(registrarLog).not.toHaveBeenCalled()
  })

  it('erro desconhecido da RPC nunca vira ok', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    expect(await salvarJustificativaDivergencia(ID, 'x')).toEqual({ ok: false, erro: 'Não foi possível salvar a justificativa.' })
    expect(registrarLog).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('RPC que levanta exceção nunca vira ok', async () => {
    rpc.mockRejectedValue(new Error('rede'))
    expect(await salvarJustificativaDivergencia(ID, 'x')).toEqual({ ok: false, erro: 'Não foi possível salvar a justificativa.' })
    expect(registrarLog).not.toHaveBeenCalled()
  })

  it("texto vazio (ou só espaços) apaga: grava '' e registra o log de apagar", async () => {
    expect(await salvarJustificativaDivergencia(ID, '   ')).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('rec_justificar_divergencia', { p_id: ID, p_texto: '' })
    expect(registrarLog).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'alterar_campo',
        descricao: 'Justificativa de divergência de quantidade apagada',
        dados: { campo: 'divergencia_justificativa', valor: '' },
      }),
    )
  })

  it('texto no limite passa inteiro; acima é cortado em ponto de código, com emoji na borda inteiro', async () => {
    const exato = 'a'.repeat(LIMITE_JUSTIFICATIVA)
    await salvarJustificativaDivergencia(ID, exato)
    expect(rpc.mock.calls[0]![1].p_texto).toBe(exato)

    // Emoji (2 unidades UTF-16) ocupando exatamente o último ponto de código permitido.
    const borda = 'a'.repeat(LIMITE_JUSTIFICATIVA - 1) + '😀' + 'zzz'
    await salvarJustificativaDivergencia(ID, borda)
    const enviado: string = rpc.mock.calls[1]![1].p_texto
    expect(enviado).toBe('a'.repeat(LIMITE_JUSTIFICATIVA - 1) + '😀')
    expect([...enviado]).toHaveLength(LIMITE_JUSTIFICATIVA)
    expect(enviado.length).toBe(LIMITE_JUSTIFICATIVA + 1) // UTF-16: o emoji não foi partido
    // O log leva o mesmo texto cortado.
    expect(registrarLog.mock.calls[1]![0].dados.valor).toBe(enviado)

    // Emoji logo após o limite: fica de fora inteiro.
    const alem = 'a'.repeat(LIMITE_JUSTIFICATIVA) + '😀'
    await salvarJustificativaDivergencia(ID, alem)
    expect(rpc.mock.calls[2]![1].p_texto).toBe(exato)
  })
})
