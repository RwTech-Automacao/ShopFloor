import { describe, it, expect, vi } from 'vitest'
import type { Perfil } from '@/modules/auth/domain/perfil'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const GESTOR: Perfil = {
  id: 'p1',
  nome: 'Gestor',
  permissoes: {} as Perfil['permissoes'],
  porModulo: { shopfloor: { administrar: true } } as Perfil['porModulo'],
  sistema: false,
}

vi.mock('@/modules/auth/application/get-sessao', () => ({
  getSessao: async () => ({ usuarioId: 'u1', nome: 'Gestor', email: 'gestor@x', perfil: GESTOR }),
}))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: async () => {} }))

describe('actions de alertas — payload malformado não lança exceção', () => {
  it('salvarRegraAction: entrada nula vira erro amigável, não exceção', async () => {
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction(null, null as unknown as Parameters<typeof salvarRegraAction>[1])
    expect(r.ok).toBe(false)
    expect(r).toEqual({ ok: false, erro: 'Não foi possível salvar a regra agora.' })
  })

  it('previaRegraAction: entrada nula vira erro amigável, não exceção', async () => {
    const { previaRegraAction } = await import('../alertas-actions')
    const r = await previaRegraAction(null as unknown as Parameters<typeof previaRegraAction>[0])
    expect(r).toEqual({ ok: false, erro: 'Não foi possível calcular a prévia agora.' })
  })

  it('excluirRegraAction: sem permissão continua recusando (não é o caminho de exceção)', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => null }))
    vi.resetModules()
    const { excluirRegraAction } = await import('../alertas-actions')
    const r = await excluirRegraAction('id1')
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para configurar alertas.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.resetModules()
  })

  it('lançamento escondido: gestor fora da lista de ALERTAS_LIBERADO_PARA é recusado', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Gestor', email: 'gestor@x', perfil: GESTOR }),
    }))
    vi.stubEnv('ALERTAS_LIBERADO_PARA', 'outra@rwtech.com.br')
    vi.resetModules()
    const { excluirRegraAction } = await import('../alertas-actions')
    const r = await excluirRegraAction('id1')
    expect(r).toEqual({ ok: false, erro: 'Recurso indisponível.' })
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
