import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const sessaoCom = (porModulo: Record<string, Record<string, boolean>>) => ({
  usuarioId: 'u1', nome: 'Ana', email: 'a@x', perfil: { porModulo, permissoes: {} },
})

function preparar(sessao: unknown, resultado: unknown = { tipo: 'ok', proprio: 5 }) {
  const buscar = vi.fn(async () => resultado)
  vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => sessao }))
  vi.doMock('../../infra/estoque-compels', () => ({ buscarEstoqueCompels: buscar }))
  return buscar
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.doUnmock('../../infra/estoque-compels')
  vi.resetModules()
})

describe('lerEstoqueCompelsAction', () => {
  it('quem vê o Fluxo (shopfloor.visualizar) recebe o estoque', async () => {
    const buscar = preparar(sessaoCom({ shopfloor: { visualizar: true } }))
    const { lerEstoqueCompelsAction } = await import('../estoque-compels-actions')
    expect(await lerEstoqueCompelsAction(' PRT446 ')).toEqual({ tipo: 'ok', proprio: 5 })
    expect(buscar).toHaveBeenCalledWith(' PRT446 ')
  })

  it('sem sessão ou sem a permissão: responde como "não existe aqui" e não consulta o Compels', async () => {
    for (const sessao of [null, sessaoCom({ recebimento: { lancar: true } })]) {
      const buscar = preparar(sessao)
      const { lerEstoqueCompelsAction } = await import('../estoque-compels-actions')
      expect(await lerEstoqueCompelsAction('PRT446')).toEqual({ tipo: 'nao_configurado' })
      expect(buscar).not.toHaveBeenCalled()
      vi.resetModules()
    }
  })
})
