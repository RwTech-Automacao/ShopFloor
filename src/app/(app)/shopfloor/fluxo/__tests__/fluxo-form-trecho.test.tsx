import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'
import type { TrechoDaOp } from '@/modules/shopfloor/domain/trechos-op'

vi.mock('server-only', () => ({}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

const { carregarFluxo, lerTrechosDaOpAction } = vi.hoisted(() => ({
  carregarFluxo: vi.fn(),
  lerTrechosDaOpAction: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/fluxo-actions', () => ({
  carregarFluxo,
  opsComBipes: vi.fn(async () => null),
  detalhePosto: vi.fn(),
  snsManutencao: vi.fn(),
  burninDetalhe: vi.fn(),
  embalagemCaixas: vi.fn(),
  historicoPosto: vi.fn(),
  producaoPeriodo: vi.fn(async () => []),
  rotaSn: vi.fn(),
  fluxoPeriodo: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/estrutura-actions', () => ({
  lerTrechosCompelsAction: vi.fn(async () => []),
  lerTrechosDaOpAction,
}))

import { FluxoForm } from '../fluxo-form'

const OPS: OpItem[] = [{ pmo: 'PMOC14', op: '8498', cliente: 'VMI', descricao: 'PLACA', criadoEm: '2026-11-01T12:00:00Z' }]
const TRECHOS: TrechoDaOp[] = [
  { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI'] },
  { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: ['Teste'] },
]
const no = (id: string, x: number) => ({
  id, x, y: 0,
  data: { ehManutencao: false, temStatus: true, recurso: 'nenhum', concluido: false, passou: 0, devemPassar: 10,
    registros: 0, aprovadas: 0, reprovadas: 0, reprovadosSemReteste: 0 },
})

beforeEach(() => {
  vi.clearAllMocks()
  carregarFluxo.mockResolvedValue({ ok: true, nodes: [no('SPI', 0), no('Teste', 300)], edges: [], qtd: 10 })
})

describe('FluxoForm — seletor de trecho', () => {
  it('lê os trechos da OP escolhida e, ao escolher um, esmaece os postos dos outros', async () => {
    lerTrechosDaOpAction.mockResolvedValue(TRECHOS)
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC14', op: '8498' }} />)

    expect(await screen.findByText('Trecho:')).toBeInTheDocument()
    expect(lerTrechosDaOpAction).toHaveBeenCalledWith('PMOC14', '8498')

    const card = (id: string) => container.querySelector(`.react-flow__node[data-id="${id}"] > div`)
    await waitFor(() => expect(card('SPI')).not.toBeNull())
    expect(card('Teste')?.className).not.toContain('opacity-30')

    fireEvent.click(screen.getByRole('button', { name: /^PRT410 \(8500\)/ }))
    await waitFor(() => expect(card('Teste')?.className).toContain('opacity-30'))
    expect(card('SPI')?.className).not.toContain('opacity-30')

    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    await waitFor(() => expect(card('Teste')?.className).not.toContain('opacity-30'))
  })

  it('OP sem trechos: nenhum seletor', async () => {
    lerTrechosDaOpAction.mockResolvedValue([])
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC14', op: '8498' }} />)
    await waitFor(() => expect(lerTrechosDaOpAction).toHaveBeenCalled())
    expect(screen.queryByText('Trecho:')).not.toBeInTheDocument()
  })
})
