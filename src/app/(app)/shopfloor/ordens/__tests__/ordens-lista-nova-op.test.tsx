import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrdensLista } from '../ordens-lista'

vi.mock('server-only', () => ({}))
vi.mock('../ordem-form', () => ({ OrdemForm: () => <button type="button">Cadastro antigo</button> }))
vi.mock('../excluir-ordem-botao', () => ({ ExcluirOrdemBotao: () => null }))
vi.mock('../fluxo-botao', () => ({ FluxoBotao: () => null }))

const props = { views: [], chavesPostos: [], postosPerfil: {}, padroes: [], pmosExistentes: [], clientesExistentes: [], dadosPorPmo: {} }

describe('botão Nova OP da lista de ordens', () => {
  it('sempre leva ao cadastro em passos; o modal antigo de criação não é oferecido', () => {
    render(<OrdensLista {...props} />)
    expect(screen.getByRole('link', { name: /Nova OP/ }).getAttribute('href')).toBe('/shopfloor/ordens/nova')
    expect(screen.queryByText('Cadastro antigo')).toBeNull()
  })
})
