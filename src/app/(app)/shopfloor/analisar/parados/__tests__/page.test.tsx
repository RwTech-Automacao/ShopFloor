import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/shopfloor/analisar/parados',
  useSearchParams: () => new URLSearchParams(),
}))

const { getSessao, lerRelatorioParados, listarRegrasParado } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  lerRelatorioParados: vi.fn(),
  listarRegrasParado: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/alertas/infra/relatorio-parados-repository', () => ({ lerRelatorioParados, listarRegrasParado }))

import ParadosPage from '../page'

const SESSAO = {
  usuarioId: 'u1', nome: 'Gestor', email: 'g@enterplak.com.br',
  perfil: { id: 'p1', nome: 'Consulta', permissoes: {}, porModulo: { shopfloor: { visualizar: true } }, sistema: false },
}
const ID_A = '11111111-1111-1111-1111-111111111111'
const ID_B = '22222222-2222-2222-2222-222222222222'

function leitura(id: string, nome: string, ativa = true) {
  return {
    ok: true,
    regra: { id, nome, limiteHoras: 24, postos: ['Teste'], pmos: [], soOpsAtivas: true, incluirManutencao: true, ativa, turnos: [] },
    relatorio: { totalPecas: 0, expediente: false, ops: [] },
    agora: new Date('2026-11-09T12:00:00Z'),
  }
}
const pagina = (regra?: string) => ParadosPage({ searchParams: Promise.resolve(regra === undefined ? {} : { regra }) })

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue(SESSAO)
})

describe('aba Peças paradas', () => {
  it('sem permissão, recusa e não lê nada', async () => {
    getSessao.mockResolvedValue({ ...SESSAO, perfil: { ...SESSAO.perfil, porModulo: { recebimento: { visualizar: true } } } })
    render(await pagina())
    expect(screen.getByText(/não tem permissão para ver as peças paradas/i)).toBeInTheDocument()
    expect(listarRegrasParado).not.toHaveBeenCalled()
  })

  it('sem regra ativa e sem ?regra, explica onde se cadastra e não lê relatório', async () => {
    listarRegrasParado.mockResolvedValue([])
    render(await pagina())
    expect(screen.getByText(/Nenhuma regra ativa/)).toBeInTheDocument()
    expect(screen.getByText(/Ajustes ShopFloor › Alertas/)).toBeInTheDocument()
    expect(lerRelatorioParados).not.toHaveBeenCalled()
  })

  it('sem ?regra, abre na primeira regra ativa', async () => {
    listarRegrasParado.mockResolvedValue([{ id: ID_A, nome: 'Alfa' }, { id: ID_B, nome: 'Beta' }])
    lerRelatorioParados.mockResolvedValue(leitura(ID_A, 'Alfa'))
    render(await pagina())
    expect(lerRelatorioParados).toHaveBeenCalledWith(ID_A)
    expect(screen.getByText('Nenhuma peça parada agora.')).toBeInTheDocument()
  })

  it('com ?regra, abre a do link, mesmo desativada (fora da lista)', async () => {
    listarRegrasParado.mockResolvedValue([{ id: ID_A, nome: 'Alfa' }])
    lerRelatorioParados.mockResolvedValue(leitura(ID_B, 'Velha', false))
    render(await pagina(ID_B))
    expect(lerRelatorioParados).toHaveBeenCalledWith(ID_B)
    expect(screen.getByText(/regra desativada/)).toBeInTheDocument()
  })

  it('regra do link inexistente: diz que não achou', async () => {
    listarRegrasParado.mockResolvedValue([{ id: ID_A, nome: 'Alfa' }])
    lerRelatorioParados.mockResolvedValue({ ok: false, motivo: 'regra_inexistente' })
    render(await pagina(ID_B))
    expect(screen.getByText(/Regra não encontrada/)).toBeInTheDocument()
  })
})
