import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
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


// Lançamento escondido: sem a variável ninguém é liberado. Aqui liberamos todos por padrão;
// o teste de recusa troca a lista dentro do próprio caso.
beforeEach(() => { vi.stubEnv('ALERTAS_LIBERADO_PARA', '*') })
afterEach(() => { vi.unstubAllEnvs() })

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

  // Os casos acima fazem doUnmock da sessão; os de baixo registram a própria sessão de gestor.
  function comoGestor() {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Gestor', email: 'gestor@x', perfil: GESTOR }),
    }))
  }

  function repositorioFalso(sobrescrever: Record<string, unknown>) {
    vi.doMock('../../infra/regras-repository', () => ({
      previaRegra: vi.fn(),
      atualizarRegra: vi.fn(),
      definirRegraAtiva: vi.fn(),
      excluirRegra: vi.fn(),
      inserirRegra: vi.fn(),
      listarOcorrencias: vi.fn(),
      resolverOcorrenciaComoAdmin: vi.fn(),
      ...sobrescrever,
    }))
  }

  function limparMocks() {
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.doUnmock('../../infra/regras-repository')
    vi.doUnmock('@/modules/logs/application/registrar-log')
    vi.resetModules()
  }

  it('salvarRegraAction: tipo desconhecido é recusado antes do banco', async () => {
    comoGestor()
    vi.resetModules()
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction(null, {
      tipo: 'lua',
      nome: 'X',
      postos: ['Teste'],
      taxaMinima: '90',
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '20',
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1'],
      ativa: true,
    })
    expect(r).toEqual({ ok: false, erro: 'Escolha o tipo da regra.' })
    limparMocks()
  })

  it('previaRegraAction: repassa o tipo, a pausa, o limite e as PMOs já validados', async () => {
    const previaRegra = vi.fn().mockResolvedValue({ ok: true, postos: [] })
    comoGestor()
    repositorioFalso({ previaRegra })
    vi.resetModules()
    const { previaRegraAction } = await import('../alertas-actions')
    const r = await previaRegraAction({
      tipo: 'tempo',
      postos: ['Teste'],
      janelaTipo: 'op',
      janelaValor: null,
      minimoBipes: '10',
      pausaMaxMin: '30',
      pmos: ['PMOA'],
    })
    expect(r).toEqual({ ok: true, postos: [] })
    expect(previaRegra).toHaveBeenCalledWith({
      tipo: 'tempo',
      postos: ['Teste'],
      janelaTipo: 'op',
      janelaValor: null,
      minimoBipes: 10,
      pausaMaxMin: 30,
      limiteOcorrencias: null,
      pmos: ['PMOA'],
    })
    limparMocks()
  })

  it('salvarRegraAction: regra nova de defeito vai com o tipo e o log diz tipo, limite e PMOs', async () => {
    const inserirRegra = vi.fn().mockResolvedValue({ ok: true, id: 'nova' })
    const registrarLog = vi.fn().mockResolvedValue(undefined)
    comoGestor()
    repositorioFalso({ inserirRegra })
    vi.doMock('@/modules/logs/application/registrar-log', () => ({ registrarLog }))
    vi.resetModules()
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction(null, {
      tipo: 'defeito',
      nome: 'Defeito 3x',
      postos: ['Teste'],
      taxaMinima: '',
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '',
      limiteOcorrencias: '3',
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1'],
      pmos: [],
      ativa: true,
    })
    expect(r).toEqual({ ok: true, id: 'nova' })
    expect(inserirRegra.mock.calls[0]![0]).toMatchObject({ tipo: 'defeito', limiteOcorrencias: 3, minimoBipes: null })
    expect(registrarLog.mock.calls[0]![0].descricao).toBe(
      'Regra de alerta "Defeito 3x" criada (Defeito repetido; Teste; Últimos 60 min; limite ≥ 3 vezes; PMOs: Todas)',
    )
    limparMocks()
  })
})
