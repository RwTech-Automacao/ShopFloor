import { afterEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

vi.mock('server-only', () => ({}))

const repo = vi.hoisted(() => ({
  listarRegras: vi.fn(async () => []),
  listarDestinatarios: vi.fn(async () => []),
  listarOcorrencias: vi.fn(async () => []),
}))
vi.mock('@/modules/alertas/infra/regras-repository', () => repo)
vi.mock('@/modules/alertas/infra/canais', () => ({
  canaisConfigurados: () => ({ telegram: true, discord: true, email: true }),
  canalDiscordConfigurado: () => true,
}))
vi.mock('@/modules/alertas/ui/alertas-tela', () => ({ AlertasTela: () => null }))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => null }))

function sessao(porModulo: Record<string, Record<string, boolean>> | null) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => (porModulo ? { usuarioId: 'u1', email: 'dora@x.com', perfil: { porModulo, permissoes: {} } } : null),
  }))
}

async function abrir(): Promise<ReactElement> {
  const { default: Pagina } = await import('../page')
  const el = await Pagina()
  expect(isValidElement(el)).toBe(true)
  return el as ReactElement
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('/sat/alertas', () => {
  it('com sat.administrar (e a trava do SAT liberada): a mesma tela de Alertas, no módulo sat, sem postos nem PMOs', async () => {
    vi.stubEnv('ALERTAS_SAT_LIBERADO_PARA', 'dora@x.com')
    sessao({ sat: { visualizar: true, administrar: true } })
    const el = await abrir()
    const props = el.props as { modulo: string; postos: unknown[]; pmos: unknown[] }
    expect(props.modulo).toBe('sat')
    expect(props.postos).toEqual([])
    expect(props.pmos).toEqual([])
    expect(repo.listarRegras).toHaveBeenCalledWith('sat')
    expect(repo.listarDestinatarios).toHaveBeenCalledWith('sat')
    expect(repo.listarOcorrencias).toHaveBeenCalledWith('sat', expect.anything())
  })

  it('sem sat.administrar (só usar o SAT, ou administrar outro módulo): sem permissão e sem ler nada', async () => {
    vi.stubEnv('ALERTAS_SAT_LIBERADO_PARA', '*')
    const perfis: Record<string, Record<string, boolean>>[] = [
      { sat: { visualizar: true, registrar_entrada: true, aprovar_nf: true } },
      { shopfloor: { administrar: true }, recebimento: { administrar: true } },
    ]
    for (const perfil of perfis) {
      sessao(perfil)
      const el = await abrir()
      expect((el.props as { modulo?: string }).modulo).toBeUndefined()
      vi.resetModules()
    }
    sessao(null)
    expect(((await abrir()).props as { modulo?: string }).modulo).toBeUndefined()
    expect(repo.listarRegras).not.toHaveBeenCalled()
  })

  it('trava do SAT fechada (variável vazia, em produção/teste): sem permissão mesmo para quem administra', async () => {
    vi.stubEnv('ALERTAS_SAT_LIBERADO_PARA', '')
    vi.stubEnv('ALERTAS_LIBERADO_PARA', '*')
    vi.stubEnv('ALERTAS_RECEBIMENTO_LIBERADO_PARA', '*')
    sessao({ sat: { visualizar: true, administrar: true } })
    expect(((await abrir()).props as { modulo?: string }).modulo).toBeUndefined()
    expect(repo.listarRegras).not.toHaveBeenCalled()
  })
})
