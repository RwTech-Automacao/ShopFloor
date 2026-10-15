import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FILTROS_LIMPOS, type FiltrosDashboard, type TotaisDashboard } from '@/modules/recebimento/domain/dashboard'
import { FiltrosDashboardBarra } from '../filtros-dashboard'
import { CartoesDashboard } from '../cartoes-dashboard'

const OPCOES = { fornecedores: ['ACME', 'Vishay'], compradores: ['Pedro'] }
const NOVENTA: FiltrosDashboard = { ...FILTROS_LIMPOS, de: '2026-07-18', ate: '2026-10-15' }

describe('barra de filtros', () => {
  it('nasce com os filtros aplicados', () => {
    render(<FiltrosDashboardBarra filtros={{ ...NOVENTA, emb: 'EMB2' }} opcoes={OPCOES} onAplicar={vi.fn()} />)
    expect(screen.getByLabelText('EMB')).toHaveValue('EMB2')
    expect(screen.getByLabelText('De')).toHaveValue('2026-07-18')
    expect(screen.getByLabelText('Até')).toHaveValue('2026-10-15')
  })

  it('Filtrar manda o formulário, aparado, e preserva o sinal (que vem do gráfico)', () => {
    const onAplicar = vi.fn()
    render(<FiltrosDashboardBarra filtros={{ ...NOVENTA, sinal: 'positiva' }} opcoes={OPCOES} onAplicar={onAplicar} />)
    fireEvent.change(screen.getByLabelText('EMB'), { target: { value: ' emb2 ' } })
    fireEvent.change(screen.getByLabelText('Código do material'), { target: { value: 'RES1' } })
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(onAplicar).toHaveBeenCalledWith({
      ...NOVENTA, emb: 'emb2', codigo: 'RES1', de: '2026-09-01', sinal: 'positiva',
    })
  })

  it('Limpar filtros tira TODOS, inclusive o período', () => {
    const onAplicar = vi.fn()
    render(<FiltrosDashboardBarra filtros={{ ...NOVENTA, fornecedor: 'Vishay' }} opcoes={OPCOES} onAplicar={onAplicar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(onAplicar).toHaveBeenCalledWith(FILTROS_LIMPOS)
  })

  it('cada filtro aplicado vira uma etiqueta que se tira sozinha', () => {
    const onAplicar = vi.fn()
    render(<FiltrosDashboardBarra filtros={{ ...NOVENTA, fornecedor: 'Vishay', sinal: 'negativa' }} opcoes={OPCOES} onAplicar={onAplicar} />)
    const lista = screen.getByRole('list', { name: 'Filtros aplicados' })
    expect(lista).toHaveTextContent('Fornecedor: Vishay')
    expect(lista).toHaveTextContent('Chegada: 18/07/2026 a 15/10/2026')
    expect(lista).toHaveTextContent('Só negativas')
    fireEvent.click(screen.getByRole('button', { name: 'Tirar o filtro Fornecedor: Vishay' }))
    expect(onAplicar).toHaveBeenLastCalledWith({ ...NOVENTA, sinal: 'negativa' })
    fireEvent.click(screen.getByRole('button', { name: 'Tirar o filtro Chegada: 18/07/2026 a 15/10/2026' }))
    expect(onAplicar).toHaveBeenLastCalledWith({ ...FILTROS_LIMPOS, fornecedor: 'Vishay', sinal: 'negativa' })
  })

  it('sem filtro nenhum, sem lista de etiquetas', () => {
    render(<FiltrosDashboardBarra filtros={FILTROS_LIMPOS} opcoes={OPCOES} onAplicar={vi.fn()} />)
    expect(screen.queryByRole('list', { name: 'Filtros aplicados' })).not.toBeInTheDocument()
  })
})

describe('cartões e rodapé', () => {
  const t: TotaisDashboard = {
    itens: 1284, comDivergencia: 137, semJustificativa: 40, positivas: 80, negativas: 57,
    embs: 42, foraDoRecortePorData: 12,
  }
  it('os três números grandes, com a porcentagem sem arredondar para 100', () => {
    render(<CartoesDashboard totais={{ ...t, itens: 10000, comDivergencia: 9999 }} sinal="" />)
    expect(screen.getByText('10.000')).toBeInTheDocument()
    expect(screen.getByText('9.999')).toBeInTheDocument()
    expect(screen.getByText('99,9% dos itens')).toBeInTheDocument()
  })
  it('o rodapé diz o recorte e quem ficou fora do período', () => {
    render(<CartoesDashboard totais={t} sinal="" />)
    expect(screen.getByTestId('rodape-contagem')).toHaveTextContent(
      '137 de 1.284 itens (10,7%) em 42 EMBs. 12 itens sem data de chegada ficaram fora do período.',
    )
  })
  it('com sinal, o cartão diz qual', () => {
    render(<CartoesDashboard totais={t} sinal="negativa" />)
    expect(screen.getByText('Com divergência (só negativas)')).toBeInTheDocument()
  })
  it('cada número tem o seu ⓘ', () => {
    render(<CartoesDashboard totais={t} sinal="" />)
    // 3 cartões + o do rodapé (o que conta como EMB).
    expect(screen.getAllByRole('button', { name: 'Como é calculado' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'O que conta como EMB' })).toBeInTheDocument()
  })
})
