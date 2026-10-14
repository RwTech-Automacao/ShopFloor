import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import type { Perfil } from '@/modules/auth/domain/perfil'
import type { EntradaRegra } from '../../domain/regra'

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

/** A entrada válida de sempre (taxa de aprovação), com o que o caso quiser trocar. */
const ENTRADA: EntradaRegra = {
  tipo: 'aprovacao',
  nome: 'Teste abaixo de 90',
  postos: ['Teste'],
  taxaMinima: '90',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '20',
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  ativa: true,
}
const entradaValida = (extra: Partial<EntradaRegra> = {}): EntradaRegra => ({ ...ENTRADA, ...extra })


// Lançamento escondido: sem a variável ninguém é liberado. Aqui liberamos todos por padrão;
// o teste de recusa troca a lista dentro do próprio caso.
beforeEach(() => { vi.stubEnv('ALERTAS_LIBERADO_PARA', '*') })
afterEach(() => { vi.unstubAllEnvs() })

describe('actions de alertas — payload malformado não lança exceção', () => {
  it('salvarRegraAction: entrada nula vira erro amigável, não exceção', async () => {
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction('shopfloor', null, null as unknown as Parameters<typeof salvarRegraAction>[2])
    expect(r.ok).toBe(false)
    // Desde o módulo, a action monta `{ ...entrada, modulo }` — e `{ ...null }` é `{}`. Continua
    // SEM exceção (é o que este caso mede); o erro agora é o da validação, mais preciso que o
    // genérico do catch.
    expect(r).toEqual({ ok: false, erro: 'Informe o nome da regra.' })
  })

  it('previaRegraAction: entrada nula vira erro amigável, não exceção', async () => {
    const { previaRegraAction } = await import('../alertas-actions')
    const r = await previaRegraAction('shopfloor', null as unknown as Parameters<typeof previaRegraAction>[1])
    expect(r).toEqual({ ok: false, erro: 'Não foi possível calcular a prévia agora.' })
  })

  it('excluirRegraAction: sem permissão continua recusando (não é o caminho de exceção)', async () => {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({ getSessao: async () => null }))
    vi.resetModules()
    const { excluirRegraAction } = await import('../alertas-actions')
    const r = await excluirRegraAction('shopfloor', 'id1')
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
    const r = await excluirRegraAction('shopfloor', 'id1')
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
    const r = await salvarRegraAction('shopfloor', null, {
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
    const r = await previaRegraAction('shopfloor', {
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
      intervalos: [],
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
    const r = await salvarRegraAction('shopfloor', null, {
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
    expect(inserirRegra.mock.calls[0]![0]).toMatchObject({ modulo: 'shopfloor', tipo: 'defeito', limiteOcorrencias: 3, minimoBipes: null })
    expect(registrarLog.mock.calls[0]![0].descricao).toBe(
      'Regra de alerta "Defeito 3x" criada (Defeito repetido; Teste; Últimos 60 min; limite ≥ 3 vezes; PMOs: Todas)',
    )
    limparMocks()
  })

  describe('resolverOcorrenciaAction', () => {
    const RESOLUCAO = {
      ok: true,
      resolucao: { ocorrenciaId: 'o1', regraId: 'g1', posto: 'Teste', jaResolvida: false },
    }

    async function chamar(explicacao?: unknown) {
      const resolverOcorrenciaComoAdmin = vi.fn().mockResolvedValue(RESOLUCAO)
      comoGestor()
      repositorioFalso({ resolverOcorrenciaComoAdmin })
      vi.doMock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn() }))
      vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }))
      // O envio pós-resolução (Discord/Telegram) não é o assunto aqui e não pode ir à rede.
      vi.doMock('../../infra/fabrica', () => ({ criarDependenciasAlertas: () => ({ portas: {}, repo: {} }) }))
      vi.doMock('../enviar-alertas', () => ({
        avaliarEEnviar: vi.fn(),
        entregarPendentes: vi.fn(),
        removerBotoesDaOcorrencia: vi.fn(),
      }))
      vi.resetModules()
      const { resolverOcorrenciaAction } = await import('../alertas-actions')
      const r = await resolverOcorrenciaAction('shopfloor', 'o1', explicacao as string | undefined)
      vi.doUnmock('../../infra/fabrica')
      vi.doUnmock('../enviar-alertas')
      limparMocks()
      return { r, resolverOcorrenciaComoAdmin }
    }

    it('repassa a explicação aparada', async () => {
      const { r, resolverOcorrenciaComoAdmin } = await chamar('  Troquei o feeder  ')
      expect(r).toEqual({ ok: true })
      expect(resolverOcorrenciaComoAdmin).toHaveBeenCalledWith('o1', 'Troquei o feeder')
    })

    it('sem explicação (ausente ou em branco) resolve, e vai vazio', async () => {
      for (const e of [undefined, '', '   ']) {
        const { r, resolverOcorrenciaComoAdmin } = await chamar(e)
        expect(r).toEqual({ ok: true })
        expect(resolverOcorrenciaComoAdmin).toHaveBeenCalledWith('o1', '')
      }
    })

    it('corta em 500 caracteres no servidor', async () => {
      const { resolverOcorrenciaComoAdmin } = await chamar('z'.repeat(3000))
      expect(resolverOcorrenciaComoAdmin.mock.calls[0]![1]).toHaveLength(500)
    })
  })
})

describe('as actions respeitam o módulo', () => {
  /** Sessão de quem administra SÓ o módulo informado (o resto do perfil é o GESTOR de cima). */
  function comoAdminDe(modulo: 'shopfloor' | 'recebimento') {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({
        usuarioId: 'u1',
        nome: 'Gestor',
        email: 'beto@x',
        perfil: { ...GESTOR, porModulo: { [modulo]: { administrar: true } } as Perfil['porModulo'] },
      }),
    }))
  }

  function limpar() {
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.doUnmock('../../infra/regras-repository')
    vi.doUnmock('@/modules/logs/application/registrar-log')
    vi.doUnmock('next/cache')
    vi.resetModules()
  }

  it('nega quem não administra o módulo pedido', async () => {
    comoAdminDe('recebimento')
    vi.resetModules()
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction('shopfloor', null, entradaValida())
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para configurar alertas.' })
    limpar()
  })

  it('aceita quem administra o módulo pedido', async () => {
    const inserirRegra = vi.fn().mockResolvedValue({ ok: true, id: 'g9' })
    comoAdminDe('recebimento')
    vi.doMock('../../infra/regras-repository', () => ({
      previaRegra: vi.fn(),
      atualizarRegra: vi.fn(),
      definirRegraAtiva: vi.fn(),
      excluirRegra: vi.fn(),
      inserirRegra,
      listarOcorrencias: vi.fn(),
      resolverOcorrenciaComoAdmin: vi.fn(),
    }))
    vi.resetModules()
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction('recebimento', null, entradaValida({ modulo: 'recebimento', tipo: 'aprovacao' }))
    // O tipo não é do Recebimento: a validação do domínio recusa ANTES de ir ao banco.
    expect(r.ok).toBe(false)
    expect(inserirRegra).not.toHaveBeenCalled()
    limpar()
  })

  it('recusa módulo forjado que não existe', async () => {
    comoAdminDe('shopfloor')
    vi.resetModules()
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction('financeiro' as never, null, entradaValida())
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para configurar alertas.' })
    limpar()
  })

  it('revalida a rota DO MÓDULO, não a do ShopFloor', async () => {
    const inserirRegra = vi.fn().mockResolvedValue({ ok: true, id: 'g9' })
    const revalidatePath = vi.fn()
    comoAdminDe('shopfloor')
    vi.doMock('../../infra/regras-repository', () => ({
      previaRegra: vi.fn(),
      atualizarRegra: vi.fn(),
      definirRegraAtiva: vi.fn(),
      excluirRegra: vi.fn(),
      inserirRegra,
      listarOcorrencias: vi.fn(),
      resolverOcorrenciaComoAdmin: vi.fn(),
    }))
    vi.doMock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn() }))
    vi.doMock('next/cache', () => ({ revalidatePath }))
    vi.resetModules()
    const { salvarRegraAction } = await import('../alertas-actions')
    await salvarRegraAction('shopfloor', null, entradaValida())
    expect(revalidatePath).toHaveBeenCalledWith('/configuracoes/sf-alertas')
    limpar()
  })
})
