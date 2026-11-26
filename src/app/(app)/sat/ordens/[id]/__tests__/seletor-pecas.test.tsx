import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { buscarItensAction, pecasSugeridasAction } from '@/modules/sat/application/ordens-actions'
import { SeletorPecas } from '../seletor-pecas'

vi.mock('server-only', () => ({}))
vi.mock('@/modules/sat/application/ordens-actions', () => ({
  pecasSugeridasAction: vi.fn(async () => ({
    ok: true,
    valor: {
      maisUsadas: [{ codigo: 'FT100', descricao: 'FONTE' }],
      kits: [{ codigo: 'PMOE74', descricao: 'MODULO CAMABIO COM CABO' }],
      estrutura: [{ codigo: 'GB001', descricao: 'GABINETE' }],
      avisos: ['Não foi possível procurar todos os kits no Compels agora.'],
    },
  })),
  buscarItensAction: vi.fn(async () => ({ ok: true, valor: [{ codigo: 'PRT706', descricao: 'PLACA' }] })),
}))

const OS = '00000000-0000-0000-0000-0000000000a1'
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('SeletorPecas', () => {
  it('mostra as 3 camadas e os avisos; clicar escolhe a peça', async () => {
    const onEscolher = vi.fn()
    render(<SeletorPecas ordemId={OS} onEscolher={onEscolher} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver peças sugeridas' }))
    await waitFor(() => expect(pecasSugeridasAction).toHaveBeenCalledWith(OS))
    expect(await screen.findByText('Mais usadas neste modelo')).toBeInTheDocument()
    expect(screen.getByText('Kits de reposição que servem')).toBeInTheDocument()
    expect(screen.getByText('Peças da estrutura')).toBeInTheDocument()
    expect(screen.getByText('Não foi possível procurar todos os kits no Compels agora.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'PMOE74 — MODULO CAMABIO COM CABO' }))
    expect(onEscolher).toHaveBeenCalledWith({ codigo: 'PMOE74', descricao: 'MODULO CAMABIO COM CABO' })
  })
  it('camada 4: busca no Compels', async () => {
    const onEscolher = vi.fn()
    render(<SeletorPecas ordemId={OS} onEscolher={onEscolher} />)
    fireEvent.change(screen.getByLabelText('Buscar item no Compels'), { target: { value: 'placa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(buscarItensAction).toHaveBeenCalledWith('placa'))
    fireEvent.click(await screen.findByRole('button', { name: 'PRT706 — PLACA' }))
    expect(onEscolher).toHaveBeenCalledWith({ codigo: 'PRT706', descricao: 'PLACA' })
  })
  it('erro da busca aparece na tela', async () => {
    vi.mocked(buscarItensAction).mockResolvedValueOnce({ ok: false, erro: 'Digite ao menos 2 letras para buscar.' })
    render(<SeletorPecas ordemId={OS} onEscolher={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('Digite ao menos 2 letras para buscar.')).toBeInTheDocument()
  })
  it('digitar busca sozinho, com atraso (debounce) e só a partir de 2 caracteres', async () => {
    vi.useFakeTimers()
    render(<SeletorPecas ordemId={OS} onEscolher={vi.fn()} />)
    const campo = screen.getByLabelText('Buscar item no Compels')
    fireEvent.change(campo, { target: { value: 'p' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(buscarItensAction).not.toHaveBeenCalled()
    fireEvent.change(campo, { target: { value: 'pl' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    fireEvent.change(campo, { target: { value: 'pla' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(buscarItensAction).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(buscarItensAction).toHaveBeenCalledTimes(1)
    expect(buscarItensAction).toHaveBeenCalledWith('pla')
  })
  it('mostra o erro quando as sugestões falham', async () => {
    vi.mocked(pecasSugeridasAction).mockResolvedValueOnce({ ok: false, erro: 'Sem permissão.' })
    render(<SeletorPecas ordemId={OS} onEscolher={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver peças sugeridas' }))
    expect(await screen.findByText('Sem permissão.')).toBeInTheDocument()
  })
})
