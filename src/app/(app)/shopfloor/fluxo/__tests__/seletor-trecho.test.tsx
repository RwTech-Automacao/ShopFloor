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
