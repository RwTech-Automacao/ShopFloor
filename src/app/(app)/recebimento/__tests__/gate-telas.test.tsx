import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
// Os componentes de filtro/paginação são clientes e usam o router do App Router, que não existe no teste.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/recebimento/registros',
  useSearchParams: () => new URLSearchParams(),
}))

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const {
  getSessao,
  consultarRegistros,
  listarValoresDistintos,
  listarTodosRegistros,
  carregarCamposFormulario,
} = vi.hoisted(() => ({
  getSessao: vi.fn(),
  consultarRegistros: vi.fn(),
  listarValoresDistintos: vi.fn(),
  listarTodosRegistros: vi.fn(),
  carregarCamposFormulario: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/recebimento/infra/registros-repository', () => ({
  consultarRegistros,
  listarValoresDistintos,
  listarTodosRegistros,
  MAX_EXPORT: 20_000,
}))
vi.mock('@/modules/recebimento/infra/processo-detalhe-repository', () => ({ carregarCamposFormulario }))

import FluxoRecebimentoPage from '../fluxo/page'
import RegistrosRecebimentoPage from '../registros/page'

function sessao(permissoes: Record<string, boolean>) {
  return {
    usuarioId: 'u1',
    nome: 'Carla Operadora',
    email: 'carla@enterplak.com.br',
    perfil: { id: 'p1', nome: 'Consulta', permissoes: {}, porModulo: { recebimento: permissoes }, sistema: false },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listarValoresDistintos.mockResolvedValue(['EMB390'])
  consultarRegistros.mockResolvedValue({ linhas: [], total: 0 })
  carregarCamposFormulario.mockResolvedValue([])
})

describe('gate das duas telas novas do Recebimento', () => {
  it('sem sessão, o Fluxo recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(null)
    render(await FluxoRecebimentoPage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(listarValoresDistintos).not.toHaveBeenCalled()
  })

  it('sem `recebimento: visualizar`, o Fluxo recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(sessao({ editar: true, gerar_etiqueta: true }))
    render(await FluxoRecebimentoPage())
    expect(screen.getByText(/não tem permissão para ver o fluxo do Recebimento/i)).toBeInTheDocument()
    expect(listarValoresDistintos).not.toHaveBeenCalled()
  })

  it('sem sessão, os Registros recusam e não consultam nada', async () => {
    getSessao.mockResolvedValue(null)
    render(await RegistrosRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(consultarRegistros).not.toHaveBeenCalled()
  })

  it('sem `recebimento: visualizar`, os Registros recusam e não consultam nada', async () => {
    getSessao.mockResolvedValue(sessao({ importar: true }))
    render(await RegistrosRecebimentoPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText(/não tem permissão para ver os registros do Recebimento/i)).toBeInTheDocument()
    expect(consultarRegistros).not.toHaveBeenCalled()
  })

  it('permissão do ShopFloor não abre as telas do Recebimento', async () => {
    getSessao.mockResolvedValue({
      ...sessao({}),
      perfil: { id: 'p1', nome: 'Produção', permissoes: {}, porModulo: { shopfloor: { visualizar: true } }, sistema: false },
    })
    render(await FluxoRecebimentoPage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
  })

  it('com `recebimento: visualizar`, os Registros consultam com os filtros da URL', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true }))
    render(await RegistrosRecebimentoPage({
      searchParams: Promise.resolve({ emb: 'EMB390', etapa: 'reprovado', tamanho: '250', pagina: '2' }),
    }))
    expect(consultarRegistros).toHaveBeenCalledWith({ emb: 'EMB390', etapa: 'reprovado' }, 2, 250)
  })
})
