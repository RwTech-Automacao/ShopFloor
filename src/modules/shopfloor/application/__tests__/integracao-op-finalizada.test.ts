// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/get-sessao', () => ({
  getSessao: vi.fn(async () => ({ perfil: {}, nome: 'Fulano', email: 'f@x.com' })),
}))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true), perfilPrecisaAprovado: vi.fn() }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({})) }))
vi.mock('../../infra/integracao-repository', () => ({
  buscarIntegracoesPorSn: vi.fn(async () => []),
  chamarSfIntegrar: vi.fn(),
  chamarSfCancelarIntegracao: vi.fn(),
}))

/** Supabase de mentira para `sf_ordens`: aplica DE VERDADE os `eq`/`neq` pedidos. */
let ordens: Record<string, unknown>[] = []

function consulta() {
  const filtros: { tipo: 'eq' | 'neq'; coluna: string; valor: string }[] = []
  const q = {
    select: () => q,
    eq(coluna: string, valor: string) {
      filtros.push({ tipo: 'eq', coluna, valor })
      return q
    },
    neq(coluna: string, valor: string) {
      filtros.push({ tipo: 'neq', coluna, valor })
      return q
    },
    order: () => q,
    range: () => q,
    then(ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) {
      let fonte = [...ordens]
      for (const f of filtros) {
        fonte = fonte.filter((r) =>
          f.tipo === 'eq' ? String(r[f.coluna] ?? '') === f.valor : String(r[f.coluna] ?? '') !== f.valor,
        )
      }
      return Promise.resolve({ data: fonte, error: null }).then(ok, falhou)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from: () => consulta() }),
}))

const { resolverPlacaIntegracaoAction } = await import('../integracao-actions')

function ordem(
  pmo: string,
  op: string,
  status: string,
  snIni: string,
  snFim: string,
  componentes: { posto: string; pmo_componente: string }[] = [],
) {
  return {
    cliente: 'Enterplak',
    pmo,
    op,
    descricao: `Produto ${pmo}`,
    qtd: 100,
    sn_ini: snIni,
    sn_fim: snFim,
    embalagem_individual: false,
    status,
    sf_ordem_postos: [{ posto: 'Integração', ordem: 1 }],
    sf_ordem_componentes: componentes,
    sf_ordem_burnin: [],
  }
}

beforeEach(() => {
  ordens = [
    // Produto FINALIZADO: a Integração por bipe tem que continuar funcionando nele.
    ordem('PMOPROD', '8900', 'FINALIZADA', 'P100', 'P199', [
      { posto: 'Integração', pmo_componente: 'PMOPLACA' },
    ]),
    // A placa da receita (OP própria, ainda ativa).
    ordem('PMOPLACA', '8800', 'ATIVA', 'L100', 'L199'),
  ]
})

describe('Integração por bipe numa OP de produto FINALIZADA', () => {
  it('resolve a placa pela receita do produto finalizado', async () => {
    const r = await resolverPlacaIntegracaoAction('PMOPROD', '8900', 'Integração', 'L150')

    expect(r).toEqual({ ok: true, pmo: 'PMOPLACA', op: '8800' })
  })

  it('placa fora da receita do produto finalizado continua recusada', async () => {
    // Prova que o caminho acima passou pela receita da OP finalizada, e não por uma receita vazia
    // (receita vazia liberaria qualquer PMO e o teste de cima passaria sem querer).
    ordens.push(ordem('PMOOUTRA', '8700', 'ATIVA', 'Z100', 'Z199'))

    const r = await resolverPlacaIntegracaoAction('PMOPROD', '8900', 'Integração', 'Z150')

    expect(r).toEqual({ ok: false, erro: 'Essa placa não faz parte da receita deste produto.' })
  })
})
