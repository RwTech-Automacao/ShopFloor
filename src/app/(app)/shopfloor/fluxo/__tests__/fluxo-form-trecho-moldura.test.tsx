import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Node, NodeProps } from '@xyflow/react'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'
import type { TrechoDaOp } from '@/modules/shopfloor/domain/trechos-op'

vi.mock('server-only', () => ({}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// O <ReactFlow> vira um espião (como no teste do enquadramento do embed): guarda as props (os nós que
// chegam ao desenho, molduras inclusive) e entrega uma instância falsa cujo `fitView` é observável.
const { rfProps, fitView } = vi.hoisted(() => ({
  rfProps: { atual: null as Record<string, unknown> | null },
  fitView: vi.fn(),
}))
vi.mock('@xyflow/react', async (importOriginal) => {
  const real = await importOriginal<typeof import('@xyflow/react')>()
  const { useEffect } = await import('react')
  const instancia = { fitView, zoomTo: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), getZoom: () => 1 }
  return {
    ...real,
    ReactFlow: (props: Record<string, unknown>) => {
      rfProps.atual = props
      // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem, como o onInit de verdade
      useEffect(() => { (props.onInit as ((i: unknown) => void) | undefined)?.(instancia) }, [])
      return null
    },
  }
})

const { carregarFluxo, lerTrechosDaOpAction, lerTrechosCompelsAction } = vi.hoisted(() => ({
  carregarFluxo: vi.fn(),
  lerTrechosDaOpAction: vi.fn(),
  lerTrechosCompelsAction: vi.fn(),
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
vi.mock('@/modules/shopfloor/application/estrutura-actions', () => ({ lerTrechosCompelsAction, lerTrechosDaOpAction }))
vi.mock('../historico-sn-dialog', () => ({ HistoricoSnDialog: () => null }))

import { FluxoForm } from '../fluxo-form'
import { limparCacheTrechosParaTeste } from '../fluxo-node'
import { MolduraTrechoNode } from '../moldura-trecho'

const OPS: OpItem[] = [{ pmo: 'PMOC14', op: '8498', cliente: 'VMI', descricao: 'PLACA', criadoEm: '2026-11-01T12:00:00Z' }]
const TRECHOS: TrechoDaOp[] = [
  { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI', 'AOI'] },
  { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: ['Teste', 'Almoxarifado'] },
]
const no = (id: string, x: number, passou: number, reprovadas = 0) => ({
  id, x, y: 0,
  data: { posto: id, wip: 0, ehManutencao: false, temStatus: true, recurso: 'nenhum', concluido: false, passou, devemPassar: 500,
    registros: passou, aprovadas: passou, reprovadas, retestes: 0, aprovadosPrimeira: 0, reprovadosSemReteste: 0 },
})
const entrada = { ...no('__entrada__', -300, 0), data: { ...no('__entrada__', -300, 0).data, ehEntrada: true } }

const nosDoDesenho = () => (rfProps.atual?.nodes as Node[] | undefined) ?? []
const molduras = () => nosDoDesenho().filter((n) => n.type === 'moldura')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  limparCacheTrechosParaTeste()
  rfProps.atual = null
  carregarFluxo.mockResolvedValue({
    ok: true, qtd: 500, edges: [],
    nodes: [entrada, no('SPI', 0, 300, 2), no('AOI', 300, 152, 1), no('Teste', 600, 90, 4)],
  })
  lerTrechosCompelsAction.mockResolvedValue([
    { posto: 'AOI', codigo: 'PRT410', compelsOp: '8500', apontadas: 0, naFila: 152, motivo: null },
    { posto: 'Teste', codigo: 'PMOC14', compelsOp: '8498', apontadas: 0, naFila: 0, motivo: null },
  ])
})

describe('FluxoForm — molduras, números e enquadramento dos trechos', () => {
  it('desenha uma moldura por trecho (abaixo dos cards, sem pegar clique) e os botões com números', async () => {
    lerTrechosDaOpAction.mockResolvedValue(TRECHOS)
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC14', op: '8498' }} />)

    await waitFor(() => expect(molduras()).toHaveLength(2))
    expect(molduras().map((m) => (m.data as { rotulo: string }).rotulo)).toEqual(['PRT410 · OP 8500', 'PMOC14 · OP 8498'])
    for (const m of molduras()) {
      expect(m.zIndex).toBe(-1)
      expect(m.selectable).toBe(false)
      expect(m.draggable).toBe(false)
      expect(m.style?.pointerEvents).toBe('none')
    }
    // A Entrada não entra em moldura: a do PRT410 começa antes do SPI (x 0), não da Entrada (x −300)
    expect(molduras()[0]!.position.x).toBe(-20)

    expect(await screen.findByRole('button', { name: 'PRT410 (8500) · 152/500 · fila 152' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PMOC14 (8498) · 90/500' })).toBeInTheDocument()
    expect(lerTrechosCompelsAction).toHaveBeenCalledWith('PMOC14', '8498')
  })

  it('escolher um trecho enquadra os postos dele e mostra o resumo; Todos volta ao desenho inteiro', async () => {
    lerTrechosDaOpAction.mockResolvedValue(TRECHOS)
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC14', op: '8498' }} />)
    const prt = await screen.findByRole('button', { name: 'PRT410 (8500) · 152/500 · fila 152' })
    await waitFor(() => expect(molduras()).toHaveLength(2))

    fitView.mockClear()
    fireEvent.click(prt)
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(fitView.mock.lastCall?.[0]).toMatchObject({ nodes: [{ id: 'SPI' }, { id: 'AOI' }], padding: 0.2 })
    expect(screen.getByTestId('resumo-trecho').textContent).toBe('Concluídas 152 · Reprovadas 3 · Apontadas no Compels 0 · Na fila 152')
    await waitFor(() => expect((molduras()[0]!.data as { escolhido: boolean }).escolhido).toBe(true))

    // PMO: o Almoxarifado (sem card) fica de fora do enquadramento; resumo só com concluídas/reprovadas
    fireEvent.click(screen.getByRole('button', { name: 'PMOC14 (8498) · 90/500' }))
    expect(fitView.mock.lastCall?.[0]).toMatchObject({ nodes: [{ id: 'Teste' }] })
    expect(screen.getByTestId('resumo-trecho').textContent).toBe('Concluídas 90 · Reprovadas 4')

    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(fitView.mock.lastCall?.[0]).not.toHaveProperty('nodes')
    expect(screen.queryByTestId('resumo-trecho')).toBeNull()
  })

  it('menos movimento pedido no sistema: enquadra sem animação', async () => {
    const mm = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('matchMedia', mm)
    try {
      lerTrechosDaOpAction.mockResolvedValue(TRECHOS)
      render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC14', op: '8498' }} />)
      fireEvent.click(await screen.findByRole('button', { name: /^PRT410 \(8500\)/ }))
      expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
      expect(fitView.mock.lastCall?.[0]).toMatchObject({ duration: 0 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('OP de um trecho só: sem moldura, sem seletor e sem consulta ao Compels', async () => {
    lerTrechosDaOpAction.mockResolvedValue(TRECHOS.slice(1))
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC14', op: '8498' }} />)
    await waitFor(() => expect(nosDoDesenho().length).toBeGreaterThan(0))
    await waitFor(() => expect(lerTrechosDaOpAction).toHaveBeenCalled())
    expect(molduras()).toHaveLength(0)
    expect(screen.queryByText('Trecho:')).not.toBeInTheDocument()
    expect(lerTrechosCompelsAction).not.toHaveBeenCalled()
  })
})

describe('MolduraTrechoNode', () => {
  it('mostra o rótulo do trecho e não pega clique', () => {
    const props = { data: { rotulo: 'PRT410 · OP 8500', escolhido: false, apagado: false } } as unknown as NodeProps
    render(<MolduraTrechoNode {...props} />)
    const el = screen.getByTestId('moldura-trecho')
    expect(el.textContent).toBe('PRT410 · OP 8500')
    expect(el.className).toContain('pointer-events-none')
  })
})
