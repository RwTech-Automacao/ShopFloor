import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { startTransition, useState } from 'react'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'

vi.mock('server-only', () => ({}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

const { carregarFluxo, opsComBipes, carregarDefeitosDaOp, carregarResumoDefeitos } = vi.hoisted(() => ({
  carregarFluxo: vi.fn(),
  opsComBipes: vi.fn(),
  carregarDefeitosDaOp: vi.fn(),
  carregarResumoDefeitos: vi.fn(),
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
vi.mock('@/modules/shopfloor/application/pesquisa-actions', () => ({
  buscarHistoricoSN: vi.fn(),
  carregarDefeitosDaOp,
  carregarResumoDefeitos,
}))

import { FluxoForm } from '../fluxo-form'
import { DefeitosLista } from '../defeitos-lista'

const OPS: OpItem[] = [
  { pmo: 'PMOC13', op: '2340/26', cliente: 'VMI', descricao: 'PLACA MONTADA', criadoEm: '2026-10-01T12:00:00Z' },
]

/** Promessa controlada pelo teste: resolve quando o teste mandar. */
function adiada<T>() {
  let resolver!: (v: T) => void
  const promessa = new Promise<T>((res) => { resolver = res })
  return { promessa, resolver }
}

/** A tela do Fluxo + um "menu": o clique aplica a troca de tela por `startTransition`, que é como o
 *  `<Link>` do Next aplica a navegação. Se a carga do Fluxo estivesse numa transição assíncrona, este
 *  clique entraria no mesmo lote e só seria aplicado quando a carga voltasse. */
function Cenario({ tela: conteudo }: { tela: React.ReactNode }) {
  const [tela, setTela] = useState('fluxo')
  return (
    <>
      <p data-testid="tela">{tela}</p>
      <button onClick={() => startTransition(() => setTela('parados'))}>Peças paradas</button>
      {tela === 'fluxo' && conteudo}
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  opsComBipes.mockResolvedValue(null)
})

describe('Fluxo: o clique no menu não fica preso atrás da carga', () => {
  it('carga do fluxo pendente: mostra "Carregando fluxo…" e o clique navega na hora', async () => {
    const lenta = adiada<unknown>()
    carregarFluxo.mockReturnValue(lenta.promessa)
    render(
      <Cenario tela={<FluxoForm ops={OPS} ordensDashboard={[]} opFixa={{ pmo: 'PMOC13', op: '2340/26' }} ocultarSeletor />} />,
    )
    expect(carregarFluxo).toHaveBeenCalledWith('PMOC13', '2340/26')
    expect(screen.getByText('Carregando fluxo…')).toBeInTheDocument()

    await act(async () => { screen.getByRole('button', { name: 'Peças paradas' }).click() })
    expect(screen.getByTestId('tela').textContent).toBe('parados')

    // A resposta que volta depois de sair da tela é ignorada (componente desmontado), sem erro.
    await act(async () => { lenta.resolver({ ok: true, nodes: [], edges: [], qtd: null }) })
    expect(screen.getByTestId('tela').textContent).toBe('parados')
  })

  it('carga dos defeitos pendente: o clique navega na hora', async () => {
    const lista = adiada<unknown>()
    carregarDefeitosDaOp.mockReturnValue(lista.promessa)
    carregarResumoDefeitos.mockResolvedValue({ ok: true, resumo: [] })
    render(<Cenario tela={<DefeitosLista pmo="PMOC13" op="2340/26" />} />)
    expect(screen.getByText('Carregando…')).toBeInTheDocument()

    await act(async () => { screen.getByRole('button', { name: 'Peças paradas' }).click() })
    expect(screen.getByTestId('tela').textContent).toBe('parados')

    await act(async () => { lista.resolver({ ok: true, linhas: [] }) })
  })
})
