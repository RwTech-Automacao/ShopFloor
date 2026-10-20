import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/recebimento/dashboard',
}))

const { getSessao, carregarDashboard, carregarOpcoesDashboard, carregarMetricas } = vi.hoisted(() => ({
  getSessao: vi.fn(), carregarDashboard: vi.fn(), carregarOpcoesDashboard: vi.fn(), carregarMetricas: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/recebimento/infra/dashboard-repository', () => ({ carregarDashboard, carregarOpcoesDashboard }))
vi.mock('@/modules/recebimento/infra/dashboard-metricas-repository', () => ({ carregarMetricas }))

import DashboardRecebimentoPage from '../page'
import { FILTROS_LIMPOS } from '@/modules/recebimento/domain/dashboard'

const VAZIO = {
  totais: { itens: 0, comDivergencia: 0, semJustificativa: 0, positivas: 0, negativas: 0, embs: 0, foraDoRecortePorData: 0 },
  fornecedores: [], semanas: [],
}
const METRICAS = {
  volume: { semanas: [], meses: [] },
  qualidade: { totais: { comResultado: 0, reprovados: 0, pecasRecebidas: 0, pecasReprovadas: 0 }, fornecedores: [], materiais: [], motivos: [] },
  atraso: { totais: { comPrazo: 0, atrasados: 0, mediaDiasAtraso: null }, fornecedores: [] },
  tempo: {
    recebimento: { n: 0, mediaDias: null, medianaDias: null },
    qualidade: { n: 0, mediaDias: null, medianaDias: null },
    parados: { dias: 15, recebimento: 0, qualidade: 0 }, semTempo: 0,
  },
  pendencias: { total: 0, faixas: { noPrazo: 0, d1a7: 0, d8a30: 0, d30mais: 0, semPrevista: 0 }, fornecedores: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
  getSessao.mockResolvedValue({
    usuarioId: 'u1', nome: 'Carla', email: 'c@e.com',
    perfil: { id: 'p1', nome: 'Consulta', permissoes: {}, porModulo: { recebimento: { visualizar: true } }, sistema: false },
  })
  carregarDashboard.mockResolvedValue(VAZIO)
  carregarOpcoesDashboard.mockResolvedValue({ fornecedores: [], compradores: [] })
  carregarMetricas.mockResolvedValue(METRICAS)
})
afterEach(() => vi.useRealTimers())

describe('página: métricas em paralelo, falhando separado', () => {
  it('carrega as métricas com os filtros da URL e o X validado', async () => {
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({ emb: 'EMB2', periodo: 'tudo', parado: '15' }) }))
    expect(carregarMetricas).toHaveBeenCalledWith({ ...FILTROS_LIMPOS, emb: 'EMB2' }, 15)
    expect(screen.getByText('Métricas')).toBeInTheDocument()
  })
  it('X inválido na URL cai em 7', async () => {
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({ parado: '5' }) }))
    expect(carregarMetricas).toHaveBeenCalledWith(expect.anything(), 7)
  })
  it('só as métricas falham: blocos antigos ficam, o aviso fica na seção nova', async () => {
    carregarMetricas.mockRejectedValue(new Error('boom'))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Itens')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/Não foi possível carregar as métricas/)
    expect(screen.queryByText(/Não foi possível carregar o dashboard/)).not.toBeInTheDocument()
  })
  it('o dashboard principal falha: as métricas não somem junto', async () => {
    carregarDashboard.mockRejectedValue(new Error('boom'))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(/Não foi possível carregar o dashboard/)).toBeInTheDocument()
    expect(screen.getByText('Métricas')).toBeInTheDocument()
  })
  it('sem permissão não consulta as métricas', async () => {
    getSessao.mockResolvedValue(null)
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(carregarMetricas).not.toHaveBeenCalled()
  })
})
