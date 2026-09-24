import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CaixaFluxo, ItemFluxo } from '@/modules/recebimento/infra/fluxo-repository'

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { carregarFluxoEmbAction, carregarItensCaixaAction } = vi.hoisted(() => ({
  carregarFluxoEmbAction: vi.fn(),
  carregarItensCaixaAction: vi.fn(),
}))
vi.mock('@/modules/recebimento/application/fluxo-actions', () => ({
  carregarFluxoEmbAction,
  carregarItensCaixaAction,
}))

/**
 * Dublê do React Flow. O canvas de verdade só desenha depois de MEDIR o container, e no jsdom todo
 * elemento tem 0×0 — com o componente real, nenhum card apareceria e não haveria o que afirmar.
 * O dublê renderiza cada nó com o `nodeTypes` de verdade (então o card do Recebimento é exercitado
 * como está em produção) e o clique chama o `onNodeClick` com o nó, como o canvas faria.
 * O que ele NÃO cobre: posição dos nós, traçado das arestas e zoom — isso é olho no smoke.
 */
vi.mock('@xyflow/react', () => {
  interface NoFake { id: string; type?: string; data: unknown }
  return {
    ReactFlow: ({
      nodes,
      edges,
      nodeTypes,
      onNodeClick,
      children,
    }: {
      nodes: NoFake[]
      edges: { id: string; source: string; target: string }[]
      nodeTypes: Record<string, (p: { id: string; data: unknown }) => ReactNode>
      onNodeClick?: (e: unknown, n: NoFake) => void
      children?: ReactNode
    }) => (
      <div data-testid="canvas" data-arestas={edges.map((e) => e.id).join(' ')}>
        {nodes.map((n) => {
          const No = nodeTypes[n.type ?? '']
          return (
            <div key={n.id} data-no={n.id} onClick={(e) => onNodeClick?.(e, n)}>
              {No ? <No id={n.id} data={n.data} /> : null}
            </div>
          )
        })}
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
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

beforeEach(() => {
  vi.clearAllMocks()
  carregarFluxoEmbAction.mockResolvedValue({ ok: true, caixas: CAIXAS })
  carregarItensCaixaAction.mockResolvedValue({ ok: true, itens: [ITEM] })
})

/** Abre o combobox de EMB, escolhe a primeira e espera o canvas aparecer. */
async function escolherEmb() {
  render(<FluxoForm embs={['EMB390', 'EMB100']} />)
  fireEvent.click(screen.getByText('Selecione a EMB'))
  fireEvent.click(await screen.findByText('EMB390'))
  await waitFor(() => expect(carregarFluxoEmbAction).toHaveBeenCalledWith('EMB390'))
  await screen.findByTestId('canvas')
}

/** O card de uma etapa dentro do canvas. */
function no(etapa: string) {
  const el = document.querySelector(`[data-no="${etapa}"]`)
  if (!el) throw new Error(`nó ${etapa} não está no canvas`)
  return el as HTMLElement
}

describe('FluxoForm', () => {
  it('só busca depois de escolher a EMB', () => {
    render(<FluxoForm embs={['EMB390']} />)
    expect(carregarFluxoEmbAction).not.toHaveBeenCalled()
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument()
  })

  it('desenha as quatro caixas como nós do canvas', async () => {
    await escolherEmb()
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
    expect(within(no('recebimento')).getByText('Recebimento')).toBeInTheDocument()
    expect(within(no('qualidade')).getByText('Qualidade')).toBeInTheDocument()
    expect(within(no('almoxarifado')).getByText('Almoxarifado')).toBeInTheDocument()
    // Reprovado é o ramo que sai da Qualidade, e dele não se volta.
    expect(within(no('reprovado')).getByText('Reprovado na Qualidade')).toBeInTheDocument()
    expect(within(no('reprovado')).getByText('ramo · fim de linha')).toBeInTheDocument()
  })

  it('liga a cadeia e desenha o ramo do Reprovado saindo da Qualidade', async () => {
    await escolherEmb()
    const canvas = screen.getByTestId('canvas')
    expect(canvas.dataset.arestas).toBe(
      'f:recebimento->qualidade f:qualidade->almoxarifado r:qualidade->reprovado',
    )
  })

  it('cada nó mostra a contagem e o tempo da etapa', async () => {
    await escolherEmb()
    const recebimento = within(no('recebimento'))
    expect(recebimento.getByText('4')).toBeInTheDocument()
    expect(recebimento.getByText('10 d')).toBeInTheDocument() // mais antigo
    expect(recebimento.getByText('3 d')).toBeInTheDocument() // tempo médio

    // Caixa sem tempo nenhum mostra travessão, não zero.
    const almoxarifado = within(no('almoxarifado'))
    expect(almoxarifado.getAllByText('—')).toHaveLength(2)
  })

  it('a marca de divergência e os itens sem tempo aparecem no nó', async () => {
    await escolherEmb()
    const qualidade = within(no('qualidade'))
    expect(qualidade.getByText('1 com divergência')).toBeInTheDocument()
    expect(qualidade.getByText('1 sem tempo')).toBeInTheDocument()
  })

  it('divergência é contador à parte, não caixa', async () => {
    await escolherEmb()
    expect(screen.getByText('2 itens com divergência')).toBeInTheDocument()
    expect(screen.getByText('10 itens na EMB EMB390 ·')).toBeInTheDocument()
  })

  it('clicar num nó lista os itens da caixa, e clicar de novo fecha', async () => {
    await escolherEmb()
    fireEvent.click(no('qualidade'))
    await waitFor(() => expect(carregarItensCaixaAction).toHaveBeenCalledWith('EMB390', 'qualidade'))
    expect(await screen.findByText('Itens em Qualidade')).toBeInTheDocument()
    const tabela = within(screen.getByRole('table'))
    expect(tabela.getByText('CAPACITOR 100uF')).toBeInTheDocument()
    expect(tabela.getByText('#123')).toBeInTheDocument()
    expect(tabela.getByText('4 d')).toBeInTheDocument() // há quanto tempo está na etapa
    expect(tabela.getByText('-10')).toBeInTheDocument() // a marca de divergência no item

    fireEvent.click(no('qualidade'))
    await waitFor(() => expect(screen.queryByText('Itens em Qualidade')).not.toBeInTheDocument())
  })

  it('item sem tempo conhecido mostra travessão na lista da caixa', async () => {
    carregarItensCaixaAction.mockResolvedValue({
      ok: true,
      itens: [{ ...ITEM, divergencia: '', desde: null, segundos: null }],
    })
    await escolherEmb()
    fireEvent.click(no('qualidade'))
    expect(await screen.findByText('Itens em Qualidade')).toBeInTheDocument()
    const tabela = within(screen.getByRole('table'))
    expect(tabela.getByText('500')).toBeInTheDocument()
    // Sem histórico o tempo é "—", não zero — e sem a marca de divergência.
    expect(tabela.getByText('—')).toBeInTheDocument()
    expect(tabela.queryByText('-10')).not.toBeInTheDocument()
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
