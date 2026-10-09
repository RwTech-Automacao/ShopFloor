import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'
import type { FluxoNodePos } from '@/modules/shopfloor/domain/fluxo-op'
import type { FitViewOptions, Node } from '@xyflow/react'

vi.mock('server-only', () => ({}))

// ===== O que se mede aqui, e por quê =====
// O jsdom NÃO faz layout: todo elemento tem 0×0, então o React Flow de verdade não enquadra nada
// e não há como ler "o fluxo está cortado" da tela. O alvo observável do enquadramento é portanto
// a CHAMADA de `fitView` na instância do React Flow (e os argumentos dela, que é onde mora a
// reserva de espaço da barra do Modo TV). Para capturar essa instância e a `fitViewOptions` do
// primeiro desenho, o componente `<ReactFlow>` é trocado por um espião que:
//   - guarda as props recebidas (é assim que a POSIÇÃO de cada card fica observável);
//   - entrega à tela uma instância falsa pelo `onInit`, cujo `fitView` é um `vi.fn()`.
// O resto do módulo `@xyflow/react` (useNodesState, tipos, Panel…) continua o de verdade.
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
      return null // os filhos (Panel/Background) precisariam do store; nada aqui depende deles
    },
  }
})

// ===== ResizeObserver controlável =====
// O jsdom não tem ResizeObserver. Este stub guarda cada observador com o elemento observado, o que
// torna observáveis as DUAS metades da regra: "o embed observa o canvas e re-enquadra" e "a tela
// normal NÃO observa o canvas" (a negativa só vale se o espião souber dizer quem está sendo visto).
interface Obs { cb: ResizeObserverCallback; alvos: Element[] }
const observadores: Obs[] = []
class ResizeObserverEspiao {
  private readonly reg: Obs
  constructor(cb: ResizeObserverCallback) { this.reg = { cb, alvos: [] }; observadores.push(this.reg) }
  observe(el: Element) { this.reg.alvos.push(el) }
  unobserve(el: Element) { this.reg.alvos = this.reg.alvos.filter((a) => a !== el) }
  disconnect() { this.reg.alvos = []; const i = observadores.indexOf(this.reg); if (i >= 0) observadores.splice(i, 1) }
}
globalThis.ResizeObserver = ResizeObserverEspiao as unknown as typeof ResizeObserver

/** Alguém observa o tamanho deste elemento? */
const observam = (el: Element) => observadores.some((o) => o.alvos.includes(el))
/** Dispara o callback de todos os observadores ativos (o navegador faria isso ao mudar o tamanho). */
function dispararResize() {
  for (const o of [...observadores]) {
    for (const el of [...o.alvos]) {
      o.cb([{ target: el, contentRect: { width: 1280, height: 720 } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
    }
  }
}

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
const opcoesDoUltimoFit = () => (fitView.mock.lastCall?.[0] ?? undefined) as FitViewOptions | undefined
const esperar = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms) }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  rfProps.atual = null
  opsComBipes.mockResolvedValue(null)
  carregarFluxo.mockResolvedValue({ ok: true, nodes: DOM, edges: [], qtd: 10 })
})
afterEach(() => { observadores.length = 0 })

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

describe('o embed se enquadra sozinho (item 2)', () => {
  it('embed: mudar o tamanho do canvas re-enquadra', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    await waitFor(() => expect(observam(canvas)).toBe(true))
    fitView.mockClear()
    await act(async () => { dispararResize() })
    await waitFor(() => expect(fitView).toHaveBeenCalled())
  })

  // A negativa precisa de uma afirmação que possa falhar: "não chamou" passaria de qualquer jeito
  // se ninguém estivesse observando. Daí as duas asserções — ninguém observa o canvas, e nada
  // enquadra depois do respiro do debounce.
  it('tela normal: mudar o tamanho NÃO re-enquadra (a pessoa posicionou de propósito)', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    await waitFor(() => expect(nosDoCanvas()).toHaveLength(2))
    expect(observam(canvas)).toBe(false)
    fitView.mockClear()
    await act(async () => { dispararResize() })
    await esperar(300)
    expect(fitView).not.toHaveBeenCalled()
  })

  it('embed: o conjunto de nós mudar re-enquadra — e um refresh que só muda os números, não', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />)
    await esperarCarregar()
    await waitFor(() => expect(fitView).toHaveBeenCalled()) // os cards chegaram
    fitView.mockClear()

    // Refresh de 20s com os MESMOS postos (só os contadores mudam): não pode re-enquadrar, senão o
    // fluxo pularia a cada 20s na TV.
    carregarFluxo.mockResolvedValue({ ok: true, nodes: [no('MONTAGEM', 0, 0, 7), no('TESTE', 400, 0, 3)], edges: [], qtd: 10 })
    await act(async () => { fireEvent(document, new Event('visibilitychange')) })
    await waitFor(() => expect(nosDoCanvas()[0]?.data).toMatchObject({ registros: 7 }))
    await esperar(300)
    expect(fitView).not.toHaveBeenCalled()

    // Agora o conjunto de postos muda (OP ganhou um posto / trocou de OP): re-enquadra.
    carregarFluxo.mockResolvedValue({ ok: true, nodes: [...DOM, no('EMBALAGEM', 800, 0)], edges: [], qtd: 10 })
    await act(async () => { fireEvent(document, new Event('visibilitychange')) })
    await waitFor(() => expect(fitView).toHaveBeenCalled())
  })
})

describe('a barra do Modo TV reserva espaço no topo ao enquadrar', () => {
  // A barra (PMO/OP + relógio + progresso) é um overlay `absolute top-0` POR CIMA do canvas: sem
  // reservar o topo, o `fitView` usa o canvas inteiro e a primeira fileira de cards vai parar
  // atrás dela. Foi o que o usuário viu como "cortado" na TV (09/10).
  const topoReservado = (o: FitViewOptions | undefined) =>
    typeof o?.padding === 'object' ? (o.padding as { top?: unknown }).top : undefined

  it('com a barra (modoTv): o enquadramento reserva o topo', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed modoTv />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    await waitFor(() => expect(observam(canvas)).toBe(true))
    fitView.mockClear()
    await act(async () => { dispararResize() })
    await waitFor(() => expect(fitView).toHaveBeenCalled())
    expect(topoReservado(opcoesDoUltimoFit())).toBe('64px')
  })

  it('sem a barra (embed sem modoTv): não reserva nada', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    await waitFor(() => expect(observam(canvas)).toBe(true))
    fitView.mockClear()
    await act(async () => { dispararResize() })
    await waitFor(() => expect(fitView).toHaveBeenCalled())
    expect(topoReservado(opcoesDoUltimoFit())).toBeUndefined()
  })

  // Na tela normal o gatilho é o botão "Reorganizar" (o re-enquadramento automático é só do embed).
  it('tela normal em Modo TV: "Reorganizar" reserva o topo; fora do Modo TV, não', async () => {
    const { unmount } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} modoTv />)
    await esperarCarregar()
    fitView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Reorganizar/ }))
    await waitFor(() => expect(fitView).toHaveBeenCalled())
    expect(topoReservado(opcoesDoUltimoFit())).toBe('64px')
    unmount()

    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    fitView.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Reorganizar/ }))
    await waitFor(() => expect(fitView).toHaveBeenCalled())
    expect(topoReservado(opcoesDoUltimoFit())).toBeUndefined()
  })

  it('o primeiro desenho (fitView do React Flow) já nasce com o topo reservado em Modo TV', async () => {
    const { unmount } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed modoTv />)
    await esperarCarregar()
    expect(topoReservado(rfProps.atual?.fitViewOptions as FitViewOptions | undefined)).toBe('64px')
    unmount()

    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    expect(topoReservado(rfProps.atual?.fitViewOptions as FitViewOptions | undefined)).toBeUndefined()
  })
})
