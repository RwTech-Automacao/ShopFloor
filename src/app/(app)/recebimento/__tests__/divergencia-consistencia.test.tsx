import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CaixaFluxo, ItemFluxo } from '@/modules/recebimento/infra/fluxo-repository'

/**
 * As DUAS telas que mostram o selo de divergência (grade de Processos e card do Fluxo) têm de
 * concordar. Hoje concordam por construção (as duas chamam `estadoDaDivergencia`), mas isto não
 * vigia a chamada: vigia o RESULTADO. Renderiza as duas telas, com a mesma linha, SEM dublar a
 * função de decisão, e compara o que o usuário vê. Se alguém reimplementar a regra em uma delas,
 * o caso em que as duas regras discordam derruba este arquivo.
 */

vi.mock('server-only', () => ({}))

const { carregarFluxoEmbAction, carregarItensCaixaAction } = vi.hoisted(() => ({
  carregarFluxoEmbAction: vi.fn(),
  carregarItensCaixaAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/modules/recebimento/application/fluxo-actions', () => ({
  carregarFluxoEmbAction,
  carregarItensCaixaAction,
  carregarHistoricoEtapaAction: vi.fn(),
  carregarHistoricoItemAction: vi.fn(),
}))
vi.mock('@/modules/recebimento/application/justificar-divergencia', () => ({
  salvarJustificativaDivergencia: vi.fn(),
}))
vi.mock('@/modules/recebimento/application/carregar-processos-grid', () => ({
  carregarValoresColuna: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Dublê mínimo do React Flow (no jsdom o canvas real não desenha); renderiza cada nó com o
// nodeTypes de verdade, então o card do Recebimento é o de produção.
vi.mock('@xyflow/react', async () => {
  const { useState } = await import('react')
  interface NoFake { id: string; type?: string; data: unknown; position: { x: number; y: number } }
  return {
    ReactFlow: ({
      nodes,
      nodeTypes,
      onNodeClick,
      children,
    }: {
      nodes: NoFake[]
      nodeTypes: Record<string, (p: { id: string; data: unknown }) => ReactNode>
      onNodeClick?: (e: unknown, n: NoFake) => void
      children?: ReactNode
    }) => (
      <div data-testid="canvas">
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

import { ProcessosGrid } from '../processos/processos-grid'
import { FluxoForm } from '../fluxo/fluxo-form'
import { decodificarEstadoGrid } from '@/modules/recebimento/domain/estado-grid'
import type { ColunaGrid } from '@/modules/recebimento/infra/processo-repository'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

/** O que o usuário vê de selo numa tela: o nome acessível e o texto de cada botão de selo. */
type SeloVisto = { nome: string; texto: string }

const SELO = { name: /^Divergência / }
function selosDe(raiz: HTMLElement): SeloVisto[] {
  return within(raiz)
    .queryAllByRole('button', SELO)
    .map((b) => ({ nome: b.getAttribute('aria-label') ?? '', texto: b.textContent ?? '' }))
}

const colunas: ColunaGrid[] = [
  { campo: 'numero', rotulo: 'Número', tipo: 'numero' },
  { campo: 'divergencia', rotulo: 'Divergência', tipo: 'lista' },
]
const estadoGrid = decodificarEstadoGrid(undefined, colunas.map((c) => c.campo))

function selosNaGrade(divergencia: number | string | null, justificativa: string): SeloVisto[] {
  const linha = {
    id: 'p1',
    numero: 101,
    divergencia,
    divergencia_justificativa: justificativa,
    divergencia_justificada_por_nome: '',
    divergencia_justificada_em: null,
  }
  render(<ProcessosGrid colunas={colunas} linhas={[linha]} total={1} estado={estadoGrid} podeJustificar />)
  // A grade renderiza tabela (desktop) E cards (celular); olha-se a tabela, como nos outros testes.
  return selosDe(screen.getByRole('table'))
}

const CAIXAS: CaixaFluxo[] = (['recebimento', 'qualidade', 'almoxarifado', 'reprovado', 'divergencia'] as const).map(
  (etapa) => ({ etapa, itens: etapa === 'qualidade' ? 1 : 0, divergentes: 0, mediaSegundos: null, maiorSegundos: null, semTempo: 0 }),
)

async function selosNoFluxo(divergencia: string, justificativa: string): Promise<SeloVisto[]> {
  const item: ItemFluxo = {
    processoId: 'p1',
    numero: 101,
    item: 'CAPJ91',
    descricao: 'CAPACITOR',
    quantidadePedido: 500,
    quantidadeRecebida: 490,
    divergencia,
    resultado: '',
    desde: '2026-09-20T12:00:00Z',
    segundos: 86400,
    justificativa,
    justificadaPorNome: '',
    justificadaEm: null,
  }
  carregarFluxoEmbAction.mockResolvedValue({ ok: true, caixas: CAIXAS, chegada: '2026-09-02' })
  carregarItensCaixaAction.mockResolvedValue({ ok: true, itens: [item] })
  render(<FluxoForm embs={['EMB390']} podeJustificar />)
  fireEvent.click(screen.getByText('Selecione a EMB'))
  fireEvent.click(await screen.findByText('EMB390'))
  await waitFor(() => expect(document.querySelector('[data-no="qualidade"]')).not.toBeNull())
  fireEvent.click(document.querySelector('[data-no="qualidade"]') as HTMLElement)
  const painel = document.querySelector('aside') as HTMLElement
  // Prova positiva: o item está na lista, então a ausência de selo é real e não "ainda carregando".
  expect(await within(painel).findByText('CAPJ91')).toBeInTheDocument()
  return selosDe(painel)
}

const PENDENTE: SeloVisto = { nome: 'Divergência sem justificativa', texto: '?' }
const JUSTIFICADA: SeloVisto = { nome: 'Divergência justificada', texto: '✅' }

// [descrição, divergência na grade (número do banco), divergência no Fluxo (texto da RPC), justificativa, esperado]
const CASOS: [string, number | null, string, string, SeloVisto[]][] = [
  ['sem divergência e sem justificativa -> sem selo', 0, '0', '', []],
  ['divergência pendente -> ?', -10, '-10', '', [PENDENTE]],
  ['divergência justificada -> ✅', 5, '5', 'Fornecedor mandou a mais; alinhado com compras.', [JUSTIFICADA]],
  ['justificativa só com espaços conta como pendente', -10, '-10', '   \n ', [PENDENTE]],
  ['borda: divergência 0 com justificativa antiga guardada -> sem selo', 0, '0', 'texto antigo', []],
  ['borda: divergência vazia/nula com justificativa antiga -> sem selo', null, '', 'texto antigo', []],
  ['borda: divergência vazia/nula sem justificativa -> sem selo', null, '', '', []],
]

describe('selo de divergência: grade de Processos e Fluxo concordam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, writable: true, value: vi.fn() })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, writable: true, value: () => null })
  })

  it.each(CASOS)('%s', async (_d, divGrade, divFluxo, justificativa, esperado) => {
    const naGrade = selosNaGrade(divGrade, justificativa)
    cleanup()
    const noFluxo = await selosNoFluxo(divFluxo, justificativa)
    // O principal: as duas telas mostram a MESMA coisa. A mensagem aponta quem divergiu.
    expect(noFluxo, `Fluxo ${JSON.stringify(noFluxo)} diverge da grade ${JSON.stringify(naGrade)}`).toEqual(naGrade)
    // E é a coisa certa (senão as duas poderiam errar juntas).
    expect(naGrade).toEqual(esperado)
  })
})
