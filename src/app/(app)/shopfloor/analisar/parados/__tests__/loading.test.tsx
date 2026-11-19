import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import CarregandoParados from '../loading'

describe('Peças paradas: carregando', () => {
  it('mostra o título e o aviso "Carregando…" enquanto os dados chegam', () => {
    render(<CarregandoParados />)
    expect(screen.getByRole('heading', { name: 'Peças paradas' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Carregando…')
  })
})
