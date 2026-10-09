import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'

vi.mock('server-only', () => ({}))

/**
 * Os três filtros rápidos são UM só estado, não três marcações: clicar no que já está ligado
 * desliga, clicar noutro troca. O que se observa aqui é a URL para onde a grade navega (o estado
 * mora nela), decodificada pelo MESMO decodificador que a página usa.
 */

const { push, carregarValores } = vi.hoisted(() => ({ push: vi.fn(), carregarValores: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/modules/recebimento/application/justificar-divergencia', () => ({
  salvarJustificativaDivergencia: vi.fn(),
}))
vi.mock('@/modules/recebimento/application/carregar-processos-grid', () => ({
  carregarValoresColuna: carregarValores,
}))

import { ProcessosGrid } from '../processos-grid'
import { decodificarEstadoGrid, type EstadoGrid } from '@/modules/recebimento/domain/estado-grid'
import type { ColunaGrid } from '@/modules/recebimento/infra/processo-repository'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const colunas: ColunaGrid[] = [
  { campo: 'numero', rotulo: 'Número', tipo: 'numero' },
  { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'texto' },
  { campo: 'divergencia', rotulo: 'Divergência', tipo: 'lista' },
]
const CAMPOS = colunas.map((c) => c.campo)
const LIMPO = decodificarEstadoGrid(undefined, CAMPOS)

/** Rótulo de cada botão → valor que ele põe no estado. */
const BOTOES = [
  ['Divergências', 'divergencias'],
  ['positivas', 'positivas'],
  ['negativas', 'negativas'],
] as const

function montar(estado: EstadoGrid = LIMPO) {
  render(<ProcessosGrid colunas={colunas} linhas={[]} total={0} estado={estado} podeJustificar />)
}

/** Os três botões, isolados do resto da tela (o cabeçalho da coluna também se chama "Divergência"). */
function grupo() {
  return within(screen.getByRole('group', { name: 'Filtros rápidos de divergência' }))
}

function clicar(rotulo: string) {
  fireEvent.click(grupo().getByRole('button', { name: rotulo }))
}

/** O estado para onde a grade navegou, pelo caminho real: URL → `?g=` → decodificador da página. */
function estadoNavegado(): EstadoGrid {
  expect(push).toHaveBeenCalledTimes(1)
  const url = String(push.mock.calls[0]![0])
  const g = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('g')
  return decodificarEstadoGrid(g ?? undefined, CAMPOS)
}

beforeEach(() => {
  vi.clearAllMocks()
  carregarValores.mockResolvedValue({ ok: true, valores: [] })
})

describe('filtros rápidos de divergência', () => {
  it.each(BOTOES)('clicar em "%s" liga o filtro %s', (rotulo, valor) => {
    montar()
    clicar(rotulo)
    expect(estadoNavegado().rapido).toBe(valor)
  })

  it.each(BOTOES)('clicar de novo em "%s" desliga (volta a mostrar tudo)', (rotulo, valor) => {
    montar({ ...LIMPO, rapido: valor })
    clicar(rotulo)
    expect(estadoNavegado().rapido).toBeUndefined()
  })

  it('clicar noutro TROCA em vez de somar (não existe "positivas + negativas")', () => {
    montar({ ...LIMPO, rapido: 'divergencias' })
    clicar('positivas')
    expect(estadoNavegado().rapido).toBe('positivas')
  })

  it('o botão ligado aparece marcado e os outros dois não', () => {
    montar({ ...LIMPO, rapido: 'positivas' })
    const g = grupo()
    expect(g.getByRole('button', { name: 'positivas' })).toHaveAttribute('aria-pressed', 'true')
    expect(g.getByRole('button', { name: 'Divergências' })).toHaveAttribute('aria-pressed', 'false')
    expect(g.getByRole('button', { name: 'negativas' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('com nenhum ligado, nenhum dos três aparece marcado', () => {
    montar()
    const g = grupo()
    for (const [rotulo] of BOTOES) {
      expect(g.getByRole('button', { name: rotulo })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('trocar de filtro rápido volta para a primeira página', () => {
    montar({ ...LIMPO, pagina: 7 })
    clicar('negativas')
    expect(estadoNavegado().pagina).toBe(0)
  })

  it('o filtro rápido preserva o filtro de coluna, a ordenação e o tamanho da página', () => {
    montar({
      ordenar: 'fornecedor',
      direcao: 'asc',
      pagina: 0,
      tamanho: 100,
      filtros: { fornecedor: { texto: 'ACME' } },
    })
    clicar('positivas')
    expect(estadoNavegado()).toEqual({
      ordenar: 'fornecedor',
      direcao: 'asc',
      pagina: 0,
      tamanho: 100,
      filtros: { fornecedor: { texto: 'ACME' } },
      rapido: 'positivas',
    })
  })

  it('com filtro rápido ligado e lista vazia, a mensagem de vazio continua fazendo sentido', () => {
    montar({ ...LIMPO, rapido: 'negativas' })
    expect(
      within(screen.getByRole('table')).getByText('Nenhum processo encontrado para os filtros aplicados.'),
    ).toBeInTheDocument()
  })
})
