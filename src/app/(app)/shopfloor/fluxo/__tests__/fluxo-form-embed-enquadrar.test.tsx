import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'
import type { FluxoNodePos } from '@/modules/shopfloor/domain/fluxo-op'
import type { Node } from '@xyflow/react'

vi.mock('server-only', () => ({}))

// ===== O que se mede aqui, e por quê =====
// O componente `<ReactFlow>` é trocado por um espião que guarda as props recebidas: é assim que a
// POSIÇÃO de cada card fica observável, já que o jsdom não faz layout nenhum (todo elemento é 0×0)
// e não há como ler da tela "onde o card está". O resto do módulo `@xyflow/react` (useNodesState,
// tipos, Panel…) continua o de verdade.
const { rfProps } = vi.hoisted(() => ({ rfProps: { atual: null as Record<string, unknown> | null } }))
vi.mock('@xyflow/react', async (importOriginal) => {
  const real = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...real,
    ReactFlow: (props: Record<string, unknown>) => {
      rfProps.atual = props
      return null // os filhos (Panel/Background) precisariam do store; nada aqui depende deles
    },
  }
})

// O jsdom não tem ResizeObserver e o canvas do React Flow observa o tamanho do container.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

const { carregarFluxo, opsComBipes } = vi.hoisted(() => ({ carregarFluxo: vi.fn(), opsComBipes: vi.fn() }))
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
vi.mock('../historico-sn-dialog', () => ({ HistoricoSnDialog: () => null }))

import { FluxoForm } from '../fluxo-form'

const OPS: OpItem[] = [
  { pmo: 'PMOC13', op: '2340/26', cliente: 'VMI', descricao: 'PLACA MONTADA', criadoEm: '2026-10-01T12:00:00Z' },
]
const OP_FIXA = { pmo: 'PMOC13', op: '2340/26' }
const CHAVE = 'sf:fluxo:pos:PMOC13:2340/26'

/** Posição PADRÃO do domínio (serpentina) — é o que o embed tem de usar. */
const no = (id: string, x: number, y: number, registros = 0): FluxoNodePos => ({
  id, x, y,
  data: {
    posto: id, wip: 0, registros, aprovadas: registros, reprovadas: 0, retestes: 0,
    aprovadosPrimeira: 0, reprovadosSemReteste: 0, ehManutencao: false, temStatus: true,
    recurso: 'nenhum', concluido: false, passou: registros, devemPassar: null,
  },
})
const DOM = [no('MONTAGEM', 0, 0), no('TESTE', 400, 0)]

/** Espera a OP carregar (o botão de Filtro só existe depois de `buscou`). */
const esperarCarregar = () => screen.findByRole('button', { name: 'Filtro e busca de SN' })
const nosDoCanvas = () => (rfProps.atual?.nodes as Node[] | undefined) ?? []
const posDe = (id: string) => nosDoCanvas().find((n) => n.id === id)?.position

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  rfProps.atual = null
  opsComBipes.mockResolvedValue(null)
  carregarFluxo.mockResolvedValue({ ok: true, nodes: DOM, edges: [], qtd: 10 })
})

describe('embed ignora a posição salva na máquina (item 1)', () => {
  it('embed: os cards ficam na posição PADRÃO do domínio, não na salva', async () => {
    localStorage.setItem(CHAVE, JSON.stringify({ MONTAGEM: { x: 999, y: 888 } }))
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />)
    await esperarCarregar()
    await waitFor(() => expect(nosDoCanvas()).toHaveLength(2))
    expect(posDe('MONTAGEM')).toEqual({ x: 0, y: 0 })
  })

  // Par positivo: sem ele o teste acima passaria mesmo se a tela nunca lesse o localStorage.
  it('tela normal: continua LENDO a posição salva daquela OP', async () => {
    localStorage.setItem(CHAVE, JSON.stringify({ MONTAGEM: { x: 999, y: 888 } }))
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    await waitFor(() => expect(nosDoCanvas()).toHaveLength(2))
    expect(posDe('MONTAGEM')).toEqual({ x: 999, y: 888 })
  })

  it('embed: arrastar um card NÃO grava no localStorage', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />)
    await esperarCarregar()
    await waitFor(() => expect(nosDoCanvas()).toHaveLength(2))
    await arrastar('MONTAGEM', { x: 123, y: 456 })
    expect(localStorage.getItem(CHAVE)).toBeNull()
  })

  // Par positivo: a tela normal é quem usa o Fluxo no dia a dia; ela tem de continuar gravando.
  it('tela normal: arrastar um card GRAVA a posição nova', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    await waitFor(() => expect(nosDoCanvas()).toHaveLength(2))
    await arrastar('MONTAGEM', { x: 123, y: 456 })
    expect(JSON.parse(localStorage.getItem(CHAVE)!)).toMatchObject({ MONTAGEM: { x: 123, y: 456 } })
  })
})

/** Move um card e solta — pelos mesmos handlers que o React Flow chamaria. */
async function arrastar(id: string, position: { x: number; y: number }) {
  const onNodesChange = rfProps.atual?.onNodesChange as (c: unknown[]) => void
  const onNodeDragStop = rfProps.atual?.onNodeDragStop as (...a: unknown[]) => void
  await act(async () => { onNodesChange([{ id, type: 'position', position, dragging: false }]) })
  await act(async () => { onNodeDragStop({}, { id, position }, []) })
}
