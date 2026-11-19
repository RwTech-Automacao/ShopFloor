import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SeletorTrecho } from '../seletor-trecho'

const T = [
  { seq: 1, codigo: 'PRT410', tipo: 'prt' as const, compelsOp: '8500', postos: ['SPI'] },
  { seq: 2, codigo: 'PRT420', tipo: 'prt' as const, compelsOp: '8499', postos: ['Inspeção PTH'] },
  { seq: 3, codigo: 'PMOC14', tipo: 'pmo' as const, compelsOp: '8498', postos: ['Teste'] },
]

describe('SeletorTrecho', () => {
  it('Todos + um botão por trecho na ordem da rota; escolher avisa o seq', () => {
    const onChange = vi.fn()
    render(<SeletorTrecho trechos={T} valor={null} onChange={onChange} />)
    expect(screen.getByText('Trecho:')).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Todos', 'PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
    expect(screen.getByRole('button', { name: 'Todos' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'PRT420 (8499)' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })
  it('OP sem trechos (ou com um só) não mostra o seletor', () => {
    const { container } = render(<SeletorTrecho trechos={T.slice(2)} valor={null} onChange={() => {}} />)
    expect(container.textContent).toBe('')
  })
})

describe('SeletorTrecho — números', () => {
  const P = new Map([
    [1, { concluidas: 152, quantidade: 500, reprovadas: 3, apontadas: 0, naFila: 152 }],
    [2, { concluidas: 40, quantidade: 500, reprovadas: 0, apontadas: 40, naFila: 0 }],
    [3, { concluidas: 1200, quantidade: 1500, reprovadas: 7, apontadas: null, naFila: null }],
  ])
  it('cada botão mostra concluídas/quantidade e a fila do Compels quando há', () => {
    render(<SeletorTrecho trechos={T} valor={null} onChange={() => {}} progresso={P} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Todos', 'PRT410 (8500) · 152/500 · fila 152', 'PRT420 (8499) · 40/500', 'PMOC14 (8498) · 1.200/1.500',
    ])
    expect(screen.queryByTestId('resumo-trecho')).toBeNull() // "Todos": sem resumo
  })
  it('resumo do trecho PRT escolhido: concluídas, reprovadas, apontadas e fila', () => {
    render(<SeletorTrecho trechos={T} valor={1} onChange={() => {}} progresso={P} />)
    expect(screen.getByTestId('resumo-trecho').textContent).toBe('Concluídas 152 · Reprovadas 3 · Apontadas no Compels 0 · Na fila 152')
  })
  it('resumo do PMO: só concluídas e reprovadas', () => {
    render(<SeletorTrecho trechos={T} valor={3} onChange={() => {}} progresso={P} />)
    expect(screen.getByTestId('resumo-trecho').textContent).toBe('Concluídas 1.200 · Reprovadas 7')
  })
})
