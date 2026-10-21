import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ListaCartoes } from '../lista-cartoes'
import type { PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'

const CAIXA: PendenciaAlmoxarifado = {
  pmo: 'PMO1', op: '100', tipo: 'caixa', codigo: 'CX[1][40]100-PMO1', pecas: 40, amostra: null, loteId: null,
  em: '2026-10-21T15:30:00Z',
}
const LOTE: PendenciaAlmoxarifado = {
  pmo: 'PMO2', op: '200', tipo: 'lote', codigo: 'LOTE[ab12cd34][50]', pecas: 50, amostra: 50, loteId: 'l1',
  em: '2026-10-21T13:05:00Z',
}

function montar(estado: Parameters<typeof ListaCartoes>[0]['estado'], onEscolher = vi.fn()) {
  render(<ListaCartoes estado={estado} onEscolher={onEscolher} onAtualizar={vi.fn()} />)
  return onEscolher
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T18:00:00Z'))
})

describe('ListaCartoes', () => {
  it('item de outro dia mostra dd/mm HH:MM em vez de "hoje"', () => {
    montar({ tipo: 'ok', itens: [{ ...CAIXA, em: '2026-10-20T18:30:00Z' }, { ...LOTE, em: '2026-10-19T13:05:00Z' }] })
    expect(screen.getByText('40 peças · fechada 20/10 15:30')).toBeInTheDocument()
    expect(screen.getByText('50 peças · bipar todas · aprovado 19/10 10:05')).toBeInTheDocument()
  })

  it('renderiza cartões de caixa e de lote com o texto da spec', () => {
    montar({ tipo: 'ok', itens: [CAIXA, LOTE] })
    expect(screen.getByText('Esperando confirmação (2)')).toBeInTheDocument()
    expect(screen.getByText('CAIXA · OP 100 · PMO1')).toBeInTheDocument()
    expect(screen.getByText('CX[1][40]100-PMO1')).toHaveClass('font-bold')
    expect(screen.getByText('40 peças · fechada hoje 12:30')).toBeInTheDocument()
    expect(screen.getByText('LOTE · OP 200 · PMO2')).toBeInTheDocument()
    expect(screen.getByText('50 peças · bipar todas · aprovado hoje 10:05')).toBeInTheDocument()
  })

  it('omite a hora vazia; o lote diz "bipar todas" mesmo com amostra nula, e a caixa nunca', () => {
    montar({ tipo: 'ok', itens: [{ ...CAIXA, em: null }, { ...LOTE, amostra: null }] })
    expect(screen.getByText('40 peças')).toBeInTheDocument()
    expect(screen.getByText(/^50 peças · bipar todas · aprovado/)).toBeInTheDocument()
  })

  it('o filtro por OP esconde as outras', () => {
    montar({ tipo: 'ok', itens: [CAIXA, LOTE] })
    fireEvent.change(screen.getByLabelText('Filtrar por OP'), { target: { value: '200 · PMO2' } })
    expect(screen.queryByText('CX[1][40]100-PMO1')).not.toBeInTheDocument()
    expect(screen.getByText('LOTE[ab12cd34][50]')).toBeInTheDocument()
  })

  it('clicar no cartão chama onEscolher com o item', () => {
    const onEscolher = montar({ tipo: 'ok', itens: [CAIXA, LOTE] })
    fireEvent.click(screen.getByRole('button', { name: /CX\[1\]\[40\]100-PMO1/ }))
    expect(onEscolher).toHaveBeenCalledWith(CAIXA)
  })

  it('vazio', () => {
    montar({ tipo: 'ok', itens: [] })
    expect(screen.getByText('Nada esperando confirmação no Almoxarifado agora.')).toBeInTheDocument()
  })

  it('vazio com filtro ativo (a OP filtrada some da lista depois do Atualizar)', () => {
    const { rerender } = render(<ListaCartoes estado={{ tipo: 'ok', itens: [CAIXA, LOTE] }} onEscolher={vi.fn()} onAtualizar={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Filtrar por OP'), { target: { value: '100 · PMO1' } })
    rerender(<ListaCartoes estado={{ tipo: 'ok', itens: [LOTE] }} onEscolher={vi.fn()} onAtualizar={vi.fn()} />)
    expect(screen.getByText('Nada esperando confirmação nesta OP.')).toBeInTheDocument()
  })

  it('erro mostra a frase e nunca o vazio', () => {
    montar({ tipo: 'erro', erro: 'Falhou a leitura.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou a leitura.')
    expect(screen.getByText('Falhou a leitura.')).toBeInTheDocument()
    expect(screen.queryByText('Nada esperando confirmação no Almoxarifado agora.')).not.toBeInTheDocument()
  })
})
