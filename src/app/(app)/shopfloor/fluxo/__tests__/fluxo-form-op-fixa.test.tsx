import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'

vi.mock('server-only', () => ({}))

// O canvas do React Flow observa o tamanho do container; o jsdom não tem ResizeObserver.
// O stub é só pra montar o componente — o que se testa aqui é o seletor e a pré-seleção.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// A tela busca TUDO por Server Action (POST pra própria URL). No teste elas viram mocks: o que se
// afirma aqui é QUAL OP a tela pediu — é por isso que a pré-seleção é observável.
const { carregarFluxo, opsComBipes } = vi.hoisted(() => ({
  carregarFluxo: vi.fn(),
  opsComBipes: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/fluxo-actions', () => ({
  carregarFluxo,
  opsComBipes,
  detalhePosto: vi.fn(),
  snsManutencao: vi.fn(),
  burninDetalhe: vi.fn(),
  embalagemCaixas: vi.fn(),
  historicoPosto: vi.fn(),
  producaoPeriodo: vi.fn(),
  rotaSn: vi.fn(),
  fluxoPeriodo: vi.fn(),
}))

import { FluxoForm } from '../fluxo-form'

const OPS: OpItem[] = [
  { pmo: 'PMOC13', op: '2340/26', cliente: 'VMI', descricao: 'PLACA MONTADA', criadoEm: '2026-10-01T12:00:00Z' },
  { pmo: 'PMOG01', op: '8248', cliente: 'Outro', descricao: 'OUTRA', criadoEm: '2026-10-02T12:00:00Z' },
]

beforeEach(() => {
  vi.clearAllMocks()
  opsComBipes.mockResolvedValue(null)
  carregarFluxo.mockResolvedValue({ ok: true, nodes: [], edges: [], qtd: null })
})

describe('FluxoForm sem as props do embed — comportamento idêntico ao de hoje', () => {
  it('mostra o seletor de OP e não pré-seleciona nada', () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} />)

    expect(screen.getByText('Selecione a OP')).toBeInTheDocument()
    expect(screen.queryByText(/PMOC13\/2340\/26/)).not.toBeInTheDocument()
  })

  it('não busca fluxo nenhum até a pessoa escolher a OP', () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} />)
    expect(carregarFluxo).not.toHaveBeenCalled()
  })
})

describe('FluxoForm com `opFixa` + `ocultarSeletor` (tela embutida no dashboard)', () => {
  it('não renderiza o seletor de OP', () => {
    render(
      <FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC13', op: '2340/26' }} ocultarSeletor />,
    )

    expect(screen.queryByText('Selecione a OP')).not.toBeInTheDocument()
    expect(screen.queryByText('OP', { selector: 'label' })).not.toBeInTheDocument()
  })

  it('já vem com a OP escolhida: a busca do fluxo dispara no primeiro render', () => {
    render(
      <FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC13', op: '2340/26' }} ocultarSeletor />,
    )

    // A OP com `/` no nome tem que chegar inteira ao repositório (2340/26, não "2340").
    expect(carregarFluxo).toHaveBeenCalledWith('PMOC13', '2340/26')
    expect(carregarFluxo).toHaveBeenCalledTimes(1)
  })

  it('`opFixa` sozinha pré-seleciona de verdade: o seletor mostra a OP escolhida', () => {
    // Sem `ocultarSeletor` o seletor continua lá — e exibe o rótulo da OP fixa, não "Selecione a OP".
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC13', op: '2340/26' }} />)

    expect(screen.getByText('PMOC13/2340/26 · VMI')).toBeInTheDocument()
    expect(screen.queryByText('Selecione a OP')).not.toBeInTheDocument()
    expect(carregarFluxo).toHaveBeenCalledWith('PMOC13', '2340/26')
  })

  it('`ocultarSeletor` sozinho esconde o seletor sem escolher OP nenhuma', () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} ocultarSeletor />)

    expect(screen.queryByText('Selecione a OP')).not.toBeInTheDocument()
    expect(carregarFluxo).not.toHaveBeenCalled()
  })
})
