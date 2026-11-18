import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const filaDoUsuario = vi.fn()
const tirarDaFila = vi.fn(async () => true)
vi.mock('../../infra/fila-repository', () => ({ filaDoUsuario, tirarDaFila }))
const cliente = { listarNfsPendentes: vi.fn(async () => []) }
vi.mock('../../infra/compels', () => ({ clienteCompelsDoFaturamento: () => cliente }))

function sessao(porModulo: Record<string, Record<string, boolean>>) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', nome: 'Fátima', email: 'f@x', perfil: { porModulo, permissoes: {} } }),
  }))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
})

describe('actions da Baixa de NF', () => {
  it('sem faturamento.baixar (só visualizar, ou admin de outro módulo): recusa sem tocar no Compels nem na fila', async () => {
    vi.stubEnv('COMPELS_BAIXA_NF', '1')
    sessao({ faturamento: { visualizar: true }, shopfloor: { administrar: true } })
    const { confirmarSelecaoAction, tirarDaFilaAction } = await import('../actions')
    expect(await confirmarSelecaoAction([1])).toEqual({ ok: false, erro: 'Você não tem permissão para baixar NF.' })
    expect(await tirarDaFilaAction('00000000-0000-0000-0000-000000000001')).toEqual({ ok: false, erro: 'Você não tem permissão para baixar NF.' })
    expect(cliente.listarNfsPendentes).not.toHaveBeenCalled()
    expect(filaDoUsuario).not.toHaveBeenCalled()
    expect(tirarDaFila).not.toHaveBeenCalled()
  })

  it('baixa desligada (sem COMPELS_BAIXA_NF): recusa explicando', async () => {
    vi.stubEnv('COMPELS_BAIXA_NF', '')
    sessao({ faturamento: { visualizar: true, baixar: true } })
    const { confirmarSelecaoAction } = await import('../actions')
    expect(await confirmarSelecaoAction([1])).toEqual({ ok: false, erro: 'A baixa de NF está desligada neste ambiente.' })
    expect(cliente.listarNfsPendentes).not.toHaveBeenCalled()
  })

  it('seleção inválida e id da fila inválido são recusados', async () => {
    vi.stubEnv('COMPELS_BAIXA_NF', 'simular')
    sessao({ faturamento: { visualizar: true, baixar: true } })
    const { confirmarSelecaoAction, tirarDaFilaAction } = await import('../actions')
    expect(await confirmarSelecaoAction([])).toMatchObject({ ok: false })
    expect(await confirmarSelecaoAction([1.5])).toMatchObject({ ok: false })
    expect(await tirarDaFilaAction('x; drop table')).toMatchObject({ ok: false })
  })
})
