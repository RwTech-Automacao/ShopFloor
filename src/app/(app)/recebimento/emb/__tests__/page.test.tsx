import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('server-only', () => ({}))
const { refresh, salvarJustificativaDivergencia } = vi.hoisted(() => ({
  refresh: vi.fn(),
  salvarJustificativaDivergencia: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
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
vi.mock('@/modules/recebimento/application/justificar-divergencia', () => ({ salvarJustificativaDivergencia }))

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

function divergencia(extra: Record<string, unknown> = {}) {
  return {
    id: 'proc-1', numero: 101, item: 'CAPJ91', descricao: 'CAPACITOR',
    quantidadePedido: 1010, quantidadeRecebida: 505, divergencia: '-505',
    justificativa: '', justificadaPorNome: '', justificadaEm: null,
    ...extra,
  }
}

function relatorio(divergencias: unknown[]) {
  return { emb: 'EMB390', processos: 2, pedidos: ['PO-4521'], fechada: true, fechadaEm: null, divergencias }
}

describe('Relatório de uma EMB: justificar', () => {
  const abrir = () => EmbRelatorioPage({ params: Promise.resolve({ emb: 'EMB390' }) })

  it('sem `recebimento: administrar`, não há botão de justificar', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true }))
    buscarRelatorioEmb.mockResolvedValue(relatorio([divergencia()]))
    render(await abrir())
    expect(screen.getByText('⚠️ sem justificativa')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Justificar|Editar/ })).not.toBeInTheDocument()
  })

  it('com `administrar`: "Justificar" na pendente e "Editar" na já justificada', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true, administrar: true }))
    buscarRelatorioEmb.mockResolvedValue(relatorio([
      divergencia(),
      divergencia({ id: 'proc-2', numero: 102, justificativa: 'Fornecedor manda o resto', justificadaPorNome: 'Ana' }),
    ]))
    render(await abrir())
    expect(screen.getByRole('button', { name: 'Justificar do processo Nº 101' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar justificativa do processo Nº 102' })).toBeInTheDocument()
  })

  it('linha sem id de processo não ganha botão (não há o que gravar)', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true, administrar: true }))
    buscarRelatorioEmb.mockResolvedValue(relatorio([divergencia({ id: null })]))
    render(await abrir())
    expect(screen.queryByRole('button', { name: /Justificar/ })).not.toBeInTheDocument()
  })

  it('abre a janela com o contexto da linha, salva pelo id do processo e recarrega a tela', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true, administrar: true }))
    buscarRelatorioEmb.mockResolvedValue(relatorio([divergencia()]))
    salvarJustificativaDivergencia.mockResolvedValue({ ok: true })
    render(await abrir())

    fireEvent.click(screen.getByRole('button', { name: 'Justificar do processo Nº 101' }))
    const contexto = screen.getByRole('group', { name: 'Contexto da divergência' })
    expect(contexto).toHaveTextContent('EMB390')
    expect(contexto).toHaveTextContent('PO-4521')
    expect(contexto).toHaveTextContent('CAPJ91')

    fireEvent.change(screen.getByRole('textbox', { name: 'Justificativa da divergência' }), { target: { value: 'Saldo vem na próxima' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(salvarJustificativaDivergencia).toHaveBeenCalledWith('proc-1', 'Saldo vem na próxima')
    expect(screen.queryByRole('group', { name: 'Contexto da divergência' })).not.toBeInTheDocument()
  })

  it('EMB com mais de uma PO: o diálogo não chuta a PO da linha', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true, administrar: true }))
    buscarRelatorioEmb.mockResolvedValue({ ...relatorio([divergencia()]), pedidos: ['PO-1', 'PO-2'] })
    render(await abrir())
    fireEvent.click(screen.getByRole('button', { name: 'Justificar do processo Nº 101' }))
    const contexto = screen.getByRole('group', { name: 'Contexto da divergência' })
    expect(contexto).not.toHaveTextContent('PO-1')
  })
})
