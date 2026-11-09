import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/recebimento/emb',
  useSearchParams: () => new URLSearchParams(),
}))

const { getSessao, listarValoresDistintos, buscarRelatorioEmb } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  listarValoresDistintos: vi.fn(),
  buscarRelatorioEmb: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/recebimento/infra/registros-repository', () => ({ listarValoresDistintos }))
vi.mock('@/modules/recebimento/infra/emb-relatorio-repository', () => ({ buscarRelatorioEmb }))

import EmbIndicePage from '../page'
import EmbRelatorioPage from '../[emb]/page'

function sessao(permissoes: Record<string, boolean>) {
  return {
    usuarioId: 'u1', nome: 'Carla', email: 'carla@enterplak.com.br',
    perfil: { id: 'p1', nome: 'Consulta', permissoes: {}, porModulo: { recebimento: permissoes }, sistema: false },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listarValoresDistintos.mockResolvedValue(['EMB390', 'EMB388CA'])
  buscarRelatorioEmb.mockResolvedValue(null)
})

describe('Relatório de EMB (índice)', () => {
  it('sem `recebimento: visualizar`, recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(sessao({ importar: true }))
    render(await EmbIndicePage())
    expect(screen.getByText(/não tem permissão para ver o relatório da EMB/i)).toBeInTheDocument()
    expect(listarValoresDistintos).not.toHaveBeenCalled()
  })

  it('com permissão, lista as EMBs do Fluxo no seletor', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true }))
    render(await EmbIndicePage())
    expect(listarValoresDistintos).toHaveBeenCalledWith('numero_emb')
    expect(screen.getByText('Relatório de EMB')).toBeInTheDocument()
    expect(screen.getByText('Selecione a EMB')).toBeInTheDocument()
  })
})

describe('Relatório de uma EMB', () => {
  it('tem o seletor com a EMB aberta e o link de volta ao índice, mesmo sem processo', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true }))
    render(await EmbRelatorioPage({ params: Promise.resolve({ emb: 'EMB%20X' }) }))
    expect(buscarRelatorioEmb).toHaveBeenCalledWith('EMB X')
    expect(screen.getByText('Nenhum processo com esta EMB.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Todas as EMBs/ })).toHaveAttribute('href', '/recebimento/emb')
    expect(screen.getAllByText('EMB X').length).toBeGreaterThan(0)
  })
})
