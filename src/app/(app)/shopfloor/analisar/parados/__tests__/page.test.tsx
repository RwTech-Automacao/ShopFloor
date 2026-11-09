import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('server-only', () => ({}))
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/shopfloor/analisar/parados',
  useSearchParams: () => new URLSearchParams(),
}))

const { getSessao, lerPecasParadasTela, lerRegraParado } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  lerPecasParadasTela: vi.fn(),
  lerRegraParado: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/alertas/infra/relatorio-parados-repository', () => ({ lerPecasParadasTela, lerRegraParado }))

import ParadosPage from '../page'

const SESSAO = {
  usuarioId: 'u1', nome: 'Gestor', email: 'g@enterplak.com.br',
  perfil: { id: 'p1', nome: 'Consulta', permissoes: {}, porModulo: { shopfloor: { visualizar: true } }, sistema: false },
}
const ID = '11111111-1111-1111-1111-111111111111'
const REGRA = {
  id: ID, nome: 'Travadas', limiteHoras: 12, postos: ['Teste'], pmos: ['PMOT'], soOpsAtivas: false,
  incluirManutencao: false, ativa: true, turnos: [],
}
const h = (horas: number) => new Date(Date.now() - horas * 3600_000)
const SNS = [
  { pmo: 'PMOT', op: 'A', posto: 'Teste', reprovada: false, numeroSerie: 'a1', pecas: 1, em: h(30), finalizada: false },
  { pmo: 'PMOT', op: 'A', posto: 'Teste', reprovada: true, numeroSerie: 'a2', pecas: 1, em: h(40), finalizada: false },
  { pmo: 'PMOT', op: 'B', posto: 'Embalagem', reprovada: false, numeroSerie: 'b1', pecas: 3, em: h(26), finalizada: true },
]
const pagina = (params: Record<string, string> = {}) => ParadosPage({ searchParams: Promise.resolve(params) })

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue(SESSAO)
  lerPecasParadasTela.mockResolvedValue(SNS)
  lerRegraParado.mockResolvedValue(null)
})

describe('Peças paradas', () => {
  it('sem permissão, recusa e não lê nada', async () => {
    getSessao.mockResolvedValue({ ...SESSAO, perfil: { ...SESSAO.perfil, porModulo: { recebimento: { visualizar: true } } } })
    render(await pagina())
    expect(screen.getByText(/não tem permissão para ver as peças paradas/i)).toBeInTheDocument()
    expect(lerPecasParadasTela).not.toHaveBeenCalled()
  })

  it('sem regra: filtros padrão (24 h, ativas, todas as PMOs, relógio corrido) e sem seletor de regra', async () => {
    render(await pagina())
    expect(lerRegraParado).not.toHaveBeenCalled()
    expect(lerPecasParadasTela).toHaveBeenCalledWith({ horas: 24, situacao: 'ativas', pmos: [], turnos: [] }, expect.any(Date))
    expect(screen.queryByText('Regra')).not.toBeInTheDocument()
    expect(screen.getByText('5 peças paradas há mais de 1 dia em 2 OPs')).toBeInTheDocument()
    expect(screen.getByText('OP finalizada')).toBeInTheDocument()
  })

  it('com ?regra: filtros da regra (tempo, situação, PMOs) e aviso com Limpar', async () => {
    lerRegraParado.mockResolvedValue(REGRA)
    render(await pagina({ regra: ID }))
    expect(lerPecasParadasTela).toHaveBeenCalledWith({ horas: 12, situacao: 'todas', pmos: ['PMOT'], turnos: [] }, expect.any(Date))
    expect(screen.getByText(/Aberta pelo alerta "Travadas"/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Limpar' })).toHaveAttribute('href', '/shopfloor/analisar/parados')
    // Postos da regra (só Teste) e tipo "parada no posto" (sem conserto): só a1.
    expect(screen.getByText('1 peça parada há mais de 12 h em 1 OP')).toBeInTheDocument()
  })

  it('a URL vence a regra', async () => {
    lerRegraParado.mockResolvedValue(REGRA)
    render(await pagina({ regra: ID, horas: '72', situacao: 'ativas', postos: '*', tipo: 'todos' }))
    expect(lerPecasParadasTela).toHaveBeenCalledWith({ horas: 72, situacao: 'ativas', pmos: ['PMOT'], turnos: [] }, expect.any(Date))
    expect(screen.getByText('5 peças paradas há mais de 3 dias em 2 OPs')).toBeInTheDocument()
  })

  it('regra do link inexistente: avisa e usa o padrão', async () => {
    render(await pagina({ regra: ID }))
    expect(screen.getByText(/A regra do link não existe mais/)).toBeInTheDocument()
    expect(lerPecasParadasTela).toHaveBeenCalledWith({ horas: 24, situacao: 'ativas', pmos: [], turnos: [] }, expect.any(Date))
  })

  it('posto e agrupar por posto filtram na tela, sem reler', async () => {
    render(await pagina())
    fireEvent.click(screen.getByRole('button', { name: 'Embalagem (3)' }))
    expect(screen.getByText('3 peças paradas há mais de 1 dia em 1 OP')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Por posto' }))
    const linhas = screen.getAllByRole('group').filter((g) => g.tagName === 'DETAILS')
    expect(linhas).toHaveLength(2)
    expect(within(linhas[0]!).getByText('Teste')).toBeInTheDocument()
    expect(within(linhas[0]!).getByText('aguardando conserto: 1')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    expect(lerPecasParadasTela).toHaveBeenCalledTimes(1)
  })
})
