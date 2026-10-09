import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const { getSessao } = vi.hoisted(() => ({ getSessao: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/recebimento/infra/processo-repository', () => ({
  carregarCatalogoColunas: vi.fn().mockResolvedValue([]),
  listarColunasLista: vi.fn().mockResolvedValue([]),
  listarProcessosGrid: vi.fn().mockResolvedValue({ linhas: [], total: 0 }),
}))
vi.mock('@/modules/recebimento/infra/registros-repository', () => ({
  listarValoresDistintos: vi.fn().mockResolvedValue(['EMB390']),
}))
vi.mock('@/modules/recebimento/application/justificar-divergencia', () => ({
  salvarJustificativaDivergencia: vi.fn(),
}))

// As telas filhas são trocadas por um stub que só abre o diálogo REAL com a prop `podeJustificar`
// que a página entregou. O que se vigia aqui é a fiação da página (qual permissão ela consulta),
// que os testes das telas filhas (que recebem a prop pronta) não enxergam.
vi.mock('../processos/processos-grid', async () => {
  const { JustificarDivergenciaDialog } = await import('../processos/justificar-divergencia-dialog')
  return {
    ProcessosGrid: ({ podeJustificar }: { podeJustificar?: boolean }) => (
      <JustificarDivergenciaDialog
        alvo={{ id: 'p1', numero: '101', texto: 'texto', autor: '', quando: null }}
        podeJustificar={podeJustificar === true}
        onFechar={() => {}}
        onSalvo={() => {}}
      />
    ),
  }
})
vi.mock('../fluxo/fluxo-form', async () => {
  const { JustificarDivergenciaDialog } = await import('../processos/justificar-divergencia-dialog')
  return {
    FluxoForm: ({ podeJustificar }: { podeJustificar?: boolean }) => (
      <JustificarDivergenciaDialog
        alvo={{ id: 'p1', numero: '101', texto: 'texto', autor: '', quando: null }}
        podeJustificar={podeJustificar === true}
        onFechar={() => {}}
        onSalvo={() => {}}
      />
    ),
  }
})

import ProcessosPage from '../processos/page'
import FluxoRecebimentoPage from '../fluxo/page'

function sessao(permissoes: Record<string, boolean>) {
  return {
    usuarioId: 'u1',
    nome: 'Carla',
    email: 'carla@enterplak.com.br',
    perfil: { id: 'p1', nome: 'Teste', permissoes: {}, porModulo: { recebimento: permissoes }, sistema: false },
  }
}

const SO_EDITAR = { visualizar: true, editar: true }
const ADMINISTRA = { visualizar: true, editar: true, administrar: true }

function exigirSomenteLeitura() {
  expect(screen.getByRole('textbox', { name: 'Justificativa da divergência' })).toHaveAttribute('readonly')
  expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
}

function exigirEditavel() {
  expect(screen.getByRole('textbox', { name: 'Justificativa da divergência' })).not.toHaveAttribute('readonly')
  expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('quem pode justificar é `administrar`, não `editar` (fiação das páginas)', () => {
  it('Processos: só `editar` => caixa só leitura e sem Salvar', async () => {
    getSessao.mockResolvedValue(sessao(SO_EDITAR))
    render(await ProcessosPage({ searchParams: Promise.resolve({}) }))
    exigirSomenteLeitura()
  })

  it('Processos: `administrar` => caixa editável com Salvar', async () => {
    getSessao.mockResolvedValue(sessao(ADMINISTRA))
    render(await ProcessosPage({ searchParams: Promise.resolve({}) }))
    exigirEditavel()
  })

  it('Fluxo: só `editar` => caixa só leitura e sem Salvar', async () => {
    getSessao.mockResolvedValue(sessao(SO_EDITAR))
    render(await FluxoRecebimentoPage())
    exigirSomenteLeitura()
  })

  it('Fluxo: `administrar` => caixa editável com Salvar', async () => {
    getSessao.mockResolvedValue(sessao(ADMINISTRA))
    render(await FluxoRecebimentoPage())
    exigirEditavel()
  })
})
