import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  CaixaFluxo,
  ItemFluxo,
  PassagemEtapa,
} from '@/modules/recebimento/infra/fluxo-repository'

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { carregarFluxoEmbAction, carregarItensCaixaAction, carregarHistoricoEtapaAction } = vi.hoisted(() => ({
  carregarFluxoEmbAction: vi.fn(),
  carregarItensCaixaAction: vi.fn(),
  carregarHistoricoEtapaAction: vi.fn(),
}))
vi.mock('@/modules/recebimento/application/fluxo-actions', () => ({
  carregarFluxoEmbAction,
  carregarItensCaixaAction,
  carregarHistoricoEtapaAction,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/**
 * Dublê do React Flow. O canvas de verdade só desenha depois de MEDIR o container, e no jsdom todo
 * elemento tem 0×0 — com o componente real, nenhum card apareceria e não haveria o que afirmar.
 * O dublê renderiza cada nó com o `nodeTypes` de verdade (então o card do Recebimento é exercitado
 * como está em produção), expõe os ids das arestas e o clique chama o `onNodeClick` com o nó, como o
 * canvas faria. `useNodesState` é o de verdade em cima de um useState.
 * O que ele NÃO cobre: posição dos nós, traçado das arestas, arraste e zoom — isso é olho no smoke.
 */
vi.mock('@xyflow/react', async () => {
  const { useState } = await import('react')
  interface NoFake { id: string; type?: string; data: unknown; position: { x: number; y: number } }
  return {
    ReactFlow: ({
      nodes,
      edges,
      nodeTypes,
      onNodeClick,
      nodesDraggable,
      children,
    }: {
      nodes: NoFake[]
      edges: { id: string }[]
      nodeTypes: Record<string, (p: { id: string; data: unknown }) => ReactNode>
      onNodeClick?: (e: unknown, n: NoFake) => void
      nodesDraggable?: boolean
      children?: ReactNode
    }) => (
      <div
        data-testid="canvas"
        data-arestas={edges.map((e) => e.id).join(' ')}
        data-arrastavel={String(nodesDraggable === true)}
      >
        {nodes.map((n) => {
          const No = nodeTypes[n.type ?? '']
          return (
            <div
              key={n.id}
              data-no={n.id}
              data-pos={`${n.position.x},${n.position.y}`}
              onClick={(e) => onNodeClick?.(e, n)}
            >
              {No ? <No id={n.id} data={n.data} /> : null}
            </div>
          )
        })}
        {children}
      </div>
    ),
    Background: () => null,
    Panel: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Handle: () => null,
    BaseEdge: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    getBezierPath: () => ['M0,0', 0, 0],
    useInternalNode: () => null,
    useStore: () => ({ width: 800, height: 600, transform: [0, 0, 1] }),
    useNodesState: <T,>(inicial: T[]) => {
      const [nos, setNos] = useState(inicial)
      return [nos, setNos, vi.fn()]
    },
  }
})

import { FluxoForm } from '../fluxo-form'

function caixa(parcial: Partial<CaixaFluxo> & { etapa: CaixaFluxo['etapa'] }): CaixaFluxo {
  return { itens: 0, divergentes: 0, mediaSegundos: null, maiorSegundos: null, semTempo: 0, ...parcial }
}

const CAIXAS: CaixaFluxo[] = [
  caixa({ etapa: 'recebimento', itens: 4, mediaSegundos: 3 * 86400, maiorSegundos: 10 * 86400 }),
  caixa({ etapa: 'qualidade', itens: 3, divergentes: 1, mediaSegundos: 4 * 86400, maiorSegundos: 4 * 86400, semTempo: 1 }),
  caixa({ etapa: 'almoxarifado', itens: 2 }),
  caixa({ etapa: 'reprovado', itens: 1, divergentes: 1 }),
]

const ITEM: ItemFluxo = {
  processoId: 'p1',
  numero: 123,
  item: 'CAPJ91',
  descricao: 'CAPACITOR 100uF',
  quantidadePedido: 500,
  quantidadeRecebida: 490,
  divergencia: '-10',
  resultado: '',
  desde: '2026-09-20T12:00:00Z',
  segundos: 4 * 86400,
}

const PASSAGEM: PassagemEtapa = {
  id: 'l1',
  dataHora: '2026-09-24T12:30:00Z', // 09:30 em Brasília
  colaborador: 'João',
  processoId: 'p9',
  numero: 456,
  item: 'CAPJ99',
  descricao: 'CAPACITOR 10uF',
  passagem: { tipo: 'avanco', de: 'recebimento', para: 'qualidade', resultado: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  carregarFluxoEmbAction.mockResolvedValue({ ok: true, caixas: CAIXAS })
  carregarItensCaixaAction.mockResolvedValue({ ok: true, itens: [ITEM] })
  carregarHistoricoEtapaAction.mockResolvedValue({ ok: true, linhas: [PASSAGEM], temMais: false })
  // jsdom não tem Fullscreen API; o Modo TV só precisa saber que foi pedida.
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
  // jsdom não tem canvas 2D (as linhas-guia do arraste desenham nele e já tratam contexto nulo).
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => null,
  })
})

/** Abre o combobox de EMB, escolhe a primeira e espera o canvas aparecer. */
async function escolherEmb() {
  render(<FluxoForm embs={['EMB390', 'EMB100']} />)
  fireEvent.click(screen.getByText('Selecione a EMB'))
  fireEvent.click(await screen.findByText('EMB390'))
  await waitFor(() => expect(carregarFluxoEmbAction).toHaveBeenCalledWith('EMB390'))
  await screen.findByTestId('canvas')
  await waitFor(() => expect(document.querySelector('[data-no="qualidade"]')).not.toBeNull())
}

/** O card de uma etapa dentro do canvas. */
function no(etapa: string) {
  const el = document.querySelector(`[data-no="${etapa}"]`)
  if (!el) throw new Error(`nó ${etapa} não está no canvas`)
  return el as HTMLElement
}

/** O painel lateral do nó (o aside que abre ao clicar). */
function painel() {
  const el = document.querySelector('aside')
  if (!el) throw new Error('o painel do nó não está aberto')
  return within(el)
}

describe('FluxoForm', () => {
  it('só busca depois de escolher a EMB', () => {
    render(<FluxoForm embs={['EMB390']} />)
    expect(carregarFluxoEmbAction).not.toHaveBeenCalled()
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument()
  })

  it('desenha as quatro caixas como nós do canvas, na posição padrão', async () => {
    await escolherEmb()
    expect(within(no('recebimento')).getByText('Recebimento')).toBeInTheDocument()
    expect(within(no('qualidade')).getByText('Qualidade')).toBeInTheDocument()
    expect(within(no('almoxarifado')).getByText('Almoxarifado')).toBeInTheDocument()
    // Reprovado é o ramo que desce da Qualidade (mesma coluna, linha de baixo).
    expect(within(no('reprovado')).getByText('Reprovado na Qualidade')).toBeInTheDocument()
    expect(no('qualidade').dataset.pos).toBe('300,0')
    expect(no('reprovado').dataset.pos).toBe('300,200')
  })

  it('liga a cadeia e desenha o ramo do Reprovado saindo da Qualidade', async () => {
    await escolherEmb()
    expect(screen.getByTestId('canvas').dataset.arestas).toBe(
      'f:recebimento->qualidade f:qualidade->almoxarifado r:qualidade->reprovado',
    )
  })

  it('os cards são arrastáveis, como no Fluxo do ShopFloor', async () => {
    await escolherEmb()
    expect(screen.getByTestId('canvas').dataset.arrastavel).toBe('true')
  })

  it('cada nó mostra a contagem e o tempo da etapa', async () => {
    await escolherEmb()
    const recebimento = within(no('recebimento'))
    expect(recebimento.getByText('4')).toBeInTheDocument()
    expect(recebimento.getByText('10 d')).toBeInTheDocument() // mais antigo
    expect(recebimento.getByText('3 d')).toBeInTheDocument() // tempo médio
    // Caixa sem tempo nenhum mostra travessão, não zero.
    expect(within(no('almoxarifado')).getAllByText('—')).toHaveLength(2)
    // A divergência aparece no card da caixa onde os itens estão.
    expect(within(no('qualidade')).getByText('1')).toBeInTheDocument()
  })

  it('divergência é contador à parte, não caixa', async () => {
    await escolherEmb()
    expect(screen.getByText('2 itens com divergência')).toBeInTheDocument()
    expect(screen.getByText('10 itens na EMB EMB390 ·')).toBeInTheDocument()
  })

  it('tem Modo TV e Reorganizar, como o Fluxo do ShopFloor', async () => {
    await escolherEmb()
    fireEvent.click(screen.getByRole('button', { name: /Modo TV/i }))
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Reorganizar/i })).toBeInTheDocument()
  })

  it('clicar no nó abre o painel com o resumo da etapa e os itens de agora', async () => {
    await escolherEmb()
    fireEvent.click(no('qualidade'))
    await waitFor(() => expect(carregarItensCaixaAction).toHaveBeenCalledWith('EMB390', 'qualidade'))
    const p = painel()
    expect(p.getByText('Qualidade')).toBeInTheDocument()
    expect(p.getByText('em conferência')).toBeInTheDocument()
    expect(p.getByText('Agora:')).toBeInTheDocument()
    expect(p.getByText('Sem tempo: 1')).toBeInTheDocument()
    // "Agora" = os itens que estão na etapa, com há quanto tempo estão nela.
    expect(await p.findByText('Itens nesta etapa (1)')).toBeInTheDocument()
    expect(p.getByText('CAPJ91')).toBeInTheDocument()
    expect(p.getByText('#123')).toBeInTheDocument()
    expect(p.getByText('4 d')).toBeInTheDocument()
    expect(p.getByText('⚠ -10')).toBeInTheDocument()
  })

  it('o histórico da etapa é acordeon: só busca ao abrir, e mostra o movimento de cada passagem', async () => {
    await escolherEmb()
    fireEvent.click(no('qualidade'))
    expect(await painel().findByText('Histórico da etapa')).toBeInTheDocument()
    // Fechado por padrão: nada de buscar histórico sem o usuário pedir.
    expect(carregarHistoricoEtapaAction).not.toHaveBeenCalled()

    fireEvent.click(painel().getByText('Histórico da etapa'))
    await waitFor(() => expect(carregarHistoricoEtapaAction).toHaveBeenCalledWith('EMB390', 'qualidade', 0))
    const p = painel()
    expect(await p.findByText('CAPJ99')).toBeInTheDocument()
    expect(p.getByText('#456')).toBeInTheDocument()
    // O mesmo formato compacto do histórico do posto do ShopFloor (hh:mm dd/mm em Brasília).
    expect(p.getByText('Recebimento → Qualidade · 24/09, 09:30')).toBeInTheDocument()
    expect(p.getByText('Histórico da etapa (1)')).toBeInTheDocument()
  })

  it('clicar de novo no nó fecha o painel, e o X também', async () => {
    await escolherEmb()
    fireEvent.click(no('qualidade'))
    await waitFor(() => expect(document.querySelector('aside')).not.toBeNull())
    fireEvent.click(no('qualidade'))
    await waitFor(() => expect(document.querySelector('aside')).toBeNull())

    fireEvent.click(no('reprovado'))
    await waitFor(() => expect(document.querySelector('aside')).not.toBeNull())
    fireEvent.click(painel().getByLabelText('Fechar'))
    await waitFor(() => expect(document.querySelector('aside')).toBeNull())
  })

  it('item sem tempo conhecido mostra travessão na lista do painel', async () => {
    carregarItensCaixaAction.mockResolvedValue({
      ok: true,
      itens: [{ ...ITEM, divergencia: '', desde: null, segundos: null }],
    })
    await escolherEmb()
    fireEvent.click(no('qualidade'))
    const p = painel()
    expect(await p.findByText('Itens nesta etapa (1)')).toBeInTheDocument()
    // Sem histórico o tempo é "—", não zero — e sem a marca de divergência.
    expect(p.getByText('—')).toBeInTheDocument()
    expect(p.queryByText('⚠ -10')).not.toBeInTheDocument()
  })

  it('a lista avisa quando a consulta bateu no teto', async () => {
    // A caixa tem 3 itens e a consulta devolveu 1: a tela avisa em vez de mentir a lista.
    await escolherEmb()
    fireEvent.click(no('qualidade'))
    expect(await painel().findByText('Mostrando os 1 mais antigos de 3.')).toBeInTheDocument()
  })

  it('erro da action aparece na tela em vez de quebrar', async () => {
    carregarFluxoEmbAction.mockResolvedValue({ ok: false, erro: 'Não foi possível carregar o fluxo agora.' })
    render(<FluxoForm embs={['EMB390']} />)
    fireEvent.click(screen.getByText('Selecione a EMB'))
    fireEvent.click(await screen.findByText('EMB390'))
    expect(await screen.findByText('Não foi possível carregar o fluxo agora.')).toBeInTheDocument()
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument()
  })
})
