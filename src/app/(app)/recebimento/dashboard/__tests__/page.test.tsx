import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
// Os componentes da tela são clientes e usam o router do App Router, que não existe no teste.
// push e pathname ESTÁVEIS (mesma referência em toda chamada): o teste inspeciona a navegação.
const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/recebimento/dashboard',
}))

const { getSessao, carregarDashboard, carregarOpcoesDashboard } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  carregarDashboard: vi.fn(),
  carregarOpcoesDashboard: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/recebimento/infra/dashboard-repository', () => ({ carregarDashboard, carregarOpcoesDashboard }))

import DashboardRecebimentoPage from '../page'
import { FILTROS_LIMPOS } from '@/modules/recebimento/domain/dashboard'

function sessao(porModulo: Record<string, Record<string, boolean>>) {
  return {
    usuarioId: 'u1',
    nome: 'Carla Operadora',
    email: 'carla@enterplak.com.br',
    perfil: { id: 'p1', nome: 'Consulta', permissoes: {}, porModulo, sistema: false },
  }
}

const VAZIO = {
  totais: { itens: 0, comDivergencia: 0, semJustificativa: 0, positivas: 0, negativas: 0, embs: 0, foraDoRecortePorData: 0 },
  fornecedores: [],
  semanas: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  // Só o relógio é falso: 15/10/2026, meio-dia em São Paulo.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
  carregarDashboard.mockResolvedValue(VAZIO)
  carregarOpcoesDashboard.mockResolvedValue({ fornecedores: ['Vishay'], compradores: ['Pedro'] })
})
afterEach(() => vi.useRealTimers())

describe('página do dashboard do Recebimento — o gate', () => {
  it('sem sessão: recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(null)
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(carregarDashboard).not.toHaveBeenCalled()
    expect(carregarOpcoesDashboard).not.toHaveBeenCalled()
  })

  it('sem `recebimento: visualizar`: recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(sessao({ recebimento: { editar: true, importar: true } }))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(/não tem permissão para ver o dashboard do Recebimento/i)).toBeInTheDocument()
    expect(carregarDashboard).not.toHaveBeenCalled()
  })

  it('permissão do ShopFloor não abre o dashboard do Recebimento', async () => {
    getSessao.mockResolvedValue(sessao({ shopfloor: { visualizar: true } }))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(carregarDashboard).not.toHaveBeenCalled()
  })
})

describe('página do dashboard do Recebimento — os filtros da URL', () => {
  it('URL vazia: consulta os últimos 90 dias', async () => {
    getSessao.mockResolvedValue(sessao({ recebimento: { visualizar: true } }))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(carregarDashboard).toHaveBeenCalledWith({ ...FILTROS_LIMPOS, de: '2026-07-18', ate: '2026-10-15' })
    expect(screen.getByText('Dashboard de divergências')).toBeInTheDocument()
  })

  it('consulta com os filtros da URL', async () => {
    getSessao.mockResolvedValue(sessao({ recebimento: { visualizar: true } }))
    render(await DashboardRecebimentoPage({
      searchParams: Promise.resolve({ fornecedor: 'Vishay', emb: 'EMB2', periodo: 'tudo', sinal: 'negativa' }),
    }))
    expect(carregarDashboard).toHaveBeenCalledWith({ ...FILTROS_LIMPOS, fornecedor: 'Vishay', emb: 'EMB2', sinal: 'negativa' })
  })

  it('erro do banco não derruba a página: mostra o aviso e os filtros', async () => {
    getSessao.mockResolvedValue(sessao({ recebimento: { visualizar: true } }))
    carregarDashboard.mockRejectedValue(new Error('boom'))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(/Não foi possível carregar o dashboard/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument()
  })
})

describe('página do dashboard do Recebimento — aplicar filtro é navegar (estado na URL)', () => {

  async function telaCom(params: Record<string, string> = {}) {
    getSessao.mockResolvedValue(sessao({ recebimento: { visualizar: true } }))
    render(await DashboardRecebimentoPage({ searchParams: Promise.resolve(params) }))
  }

  it('Filtrar com uma EMB navega para a URL com a EMB (o recorte padrão não vai na URL)', async () => {
    await telaCom()
    fireEvent.change(screen.getByLabelText('EMB'), { target: { value: 'EMB2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?emb=EMB2')
  })

  it('Limpar filtros navega para periodo=tudo', async () => {
    await telaCom()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?periodo=tudo')
  })

  it('tirar uma etiqueta navega para a URL sem aquele filtro', async () => {
    await telaCom({ fornecedor: 'Vishay', emb: 'EMB2' })
    fireEvent.click(screen.getByRole('button', { name: 'Tirar o filtro Fornecedor: Vishay' }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?emb=EMB2')
  })
})
