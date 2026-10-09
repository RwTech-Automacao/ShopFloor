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

  // A sonda que denuncia a sabotagem: o teste acima nunca passa por `alternarTv`/`iniciarApresentacao`.
  // `modoTv` SEM `embed` é um estado válido do componente e mantém o botão na tela.
  it('com modoTv, clicar em "Modo TV" NÃO pede a tela cheia ao navegador', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} modoTv />)
    await esperarCarregar()
    fireEvent.click(screen.getByRole('button', { name: /Modo TV/ }))
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(exitFullscreen).not.toHaveBeenCalled()
  })

  it('no embed (com ou sem modoTv) o botão "Modo TV" não existe', async () => {
    const { unmount } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />)
    await esperarCarregar()
    expect(screen.queryByRole('button', { name: /Modo TV/ })).not.toBeInTheDocument()
    unmount()
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed modoTv />)
    await esperarCarregar()
    expect(screen.queryByRole('button', { name: /Modo TV/ })).not.toBeInTheDocument()
  })

  // Caminho de `alternarTv` com embed: o outro chamador é o "Sair (Esc)" da barra, que aparece
  // quando o documento do iframe reporta tela cheia. Com embed ele não pode mexer na tela cheia.
  it('no embed, "Sair (Esc)" (outro chamador de alternarTv) NÃO mexe na tela cheia', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />)
    await esperarCarregar()
    const canvas = container.querySelector('.fluxo-canvas') as HTMLElement
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => canvas })
    try {
      fireEvent(document, new Event('fullscreenchange'))
      fireEvent.click(await screen.findByText(/Sair \(Esc\)/))
      expect(requestFullscreen).not.toHaveBeenCalled()
      expect(exitFullscreen).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    }
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

/** Os três controles, pelo que o usuário enxerga. */
function controles() {
  return {
    filtro: screen.getByRole('button', { name: 'Filtro e busca de SN' }),
    zoom: screen.getByTestId('controle-zoom'),
    defeitos: screen.getByRole('button', { name: /Defeitos/ }),
  }
}
const NOMES = ['filtro', 'zoom', 'defeitos'] as const

describe('os três controles de operação (hover)', () => {
  // CASO 4 — o teste que protege o tablet. Tablet não tem hover: se algum dos três ganhar
  // `opacity-0` fora do Modo TV, o supervisor perde o filtro, o zoom e os defeitos.
  it('tela normal (fora do Modo TV): Filtro, Zoom e Defeitos continuam visíveis sem hover', async () => {
    render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />) // seletor visível = tela normal
    await esperarCarregar()
    const c = controles()
    for (const n of NOMES) {
      const el = c[n]
      expect(el.className, n).not.toMatch(/opacity-0/)
      expect(el.className, n).not.toMatch(/group-hover/)
      expect(el.className, n).not.toMatch(/pointer-events-none/)
    }
  })

  // CASO 1 da spec: o embed SEM `?modo=tv` tem layout normal, mas os botões JÁ escondidos (hover).
  // Um teste por controle: um `for` único mascararia qual deles regrediu.
  describe.each(NOMES)('embed sem modoTv: %s', (nome) => {
    it('já só no hover, com layout normal', async () => {
      const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed />)
      await esperarCarregar()
      expect(controles()[nome]).toHaveClass('opacity-0', 'group-hover/canvas:opacity-100')
      expect(container.querySelector('.fluxo-canvas')).not.toHaveClass('fixed')
    })
  })

  // Modo TV da tela normal (tela cheia do navegador): também esconde.
  describe.each(NOMES)('tela normal em tela cheia do navegador: %s', (nome) => {
    it('só no hover', async () => {
      const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} />)
      await esperarCarregar()
      const canvas = container.querySelector('.fluxo-canvas') as HTMLElement
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => canvas })
      try {
        fireEvent(document, new Event('fullscreenchange'))
        await waitFor(() => expect(controles()[nome]).toHaveClass('opacity-0'))
      } finally {
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
      }
    })
  })

  // Modo TV por prop SEM embed: prova que o esconder também olha o Modo TV, não só o embed.
  describe.each(NOMES)('modoTv sem embed: %s', (nome) => {
    it('só no hover', async () => {
      render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
      await esperarCarregar()
      expect(controles()[nome]).toHaveClass('opacity-0', 'group-hover/canvas:opacity-100')
    })
  })

  describe.each(NOMES)('embed com modoTv: %s', (nome) => {
    it('só no hover', async () => {
      render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor embed modoTv />)
      await esperarCarregar()
      expect(controles()[nome]).toHaveClass('opacity-0', 'group-hover/canvas:opacity-100')
    })
  })

  it('o canvas é o `group/canvas` (o hover é dele, não do botão invisível)', async () => {
    const { container } = render(<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={OP_FIXA} ocultarSeletor modoTv />)
    await esperarCarregar()
    expect(container.querySelector('.fluxo-canvas')).toHaveClass('group/canvas')
  })
})
