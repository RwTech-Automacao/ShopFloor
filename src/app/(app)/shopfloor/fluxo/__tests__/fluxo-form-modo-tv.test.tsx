import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

// O diálogo é trocado por um espião do `container` (alvo do portal): é o que torna observável
// "o destino é o canvas" e "o fullscreenchange do Dashboard não zera o destino".
const { containerRecebido } = vi.hoisted(() => ({ containerRecebido: vi.fn() }))
vi.mock('../historico-sn-dialog', () => ({
  HistoricoSnDialog: ({ container }: { container?: HTMLElement }) => {
    containerRecebido(container)
    return null
  },
}))

import { FluxoForm } from '../fluxo-form'

const OPS: OpItem[] = [
  { pmo: 'PMOC13', op: '2340/26', cliente: 'VMI', descricao: 'PLACA MONTADA', criadoEm: '2026-10-01T12:00:00Z' },
]

// O jsdom não implementa a API de tela cheia: instalar espiões é o que torna "NÃO chamou"
// observável. O par positivo (tela normal CHAMA) prova que o espião funciona.
const requestFullscreen = vi.fn(() => Promise.resolve())
const exitFullscreen = vi.fn(() => Promise.resolve())

beforeEach(() => {
  vi.clearAllMocks()
  opsComBipes.mockResolvedValue(null)
  carregarFluxo.mockResolvedValue({ ok: true, nodes: [], edges: [], qtd: null })
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: requestFullscreen })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
})
afterEach(() => {
  delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
  delete (document as { exitFullscreen?: unknown }).exitFullscreen
})

const OP_FIXA = { pmo: 'PMOC13', op: '2340/26' }
/** Espera a OP carregar (o botão de Filtro só existe depois de `buscou`). */
const esperarCarregar = () => screen.findByRole('button', { name: 'Filtro e busca de SN' })

describe('FluxoForm com modoTv (embed em Modo TV)', () => {
  // O teste que prova a feature: é o único que denuncia o sintoma original (o Dashboard saindo
  // da tela cheia junto com o Fluxo).
  it('com modoTv o navegador NÃO entra em tela cheia', async () => {
    const { unmount } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()

    // O evento que o Dashboard dispara no pai também chega ao documento do iframe: não pode
    // desligar o modo nem pedir nada ao navegador.
    fireEvent(document, new Event('fullscreenchange'))
    await waitFor(() => expect(carregarFluxo).toHaveBeenCalled())
    unmount() // desmontar também não pode chamar exitFullscreen

    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(exitFullscreen).not.toHaveBeenCalled()
  })

  // Par positivo: sem ele o "não chamou" acima passaria mesmo com o espião quebrado.
  it('sem modoTv o botão "Modo TV" continua pedindo a tela cheia ao navegador', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    fireEvent.click(screen.getByRole('button', { name: /Modo TV/ }))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('o canvas ocupa o container todo (fixed) em vez de 70vh', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    expect(canvas).toHaveClass('fixed', 'inset-0')
    expect(canvas).not.toHaveClass('h-[70vh]')
  })

  it('fora do modoTv o canvas segue como hoje (relative, 70vh, sem fixed)', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    expect(canvas).toHaveClass('relative', 'h-[70vh]')
    expect(canvas).not.toHaveClass('fixed')
  })

  it('o diálogo do SN faz portal no canvas e o fullscreenchange do Dashboard não zera esse alvo', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas')!
    await waitFor(() => expect(containerRecebido).toHaveBeenLastCalledWith(canvas))

    fireEvent(document, new Event('fullscreenchange'))
    await new Promise((r) => setTimeout(r, 0))

    expect(containerRecebido).toHaveBeenLastCalledWith(canvas)
  })

  it('mostra a barra de apresentação (progresso) mas SEM o botão "Sair (Esc)"', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()
    expect(screen.getByText('progresso')).toBeInTheDocument() // a barra existe (par positivo)
    expect(screen.queryByText(/Sair \(Esc\)/)).not.toBeInTheDocument() // quem sai é o Dashboard
  })
})
