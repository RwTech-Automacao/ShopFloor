import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/recebimento/dashboard',
}))

import { DashboardRecebimento } from '../dashboard-recebimento'
import { FILTROS_LIMPOS, type DadosDashboard } from '@/modules/recebimento/domain/dashboard'

const NOVENTA = { ...FILTROS_LIMPOS, de: '2026-07-18', ate: '2026-10-15' }
const DADOS: DadosDashboard = {
  totais: { itens: 9, comDivergencia: 6, semJustificativa: 4, positivas: 3, negativas: 3, embs: 4, foraDoRecortePorData: 1 },
  fornecedores: [
    { fornecedor: 'Panasonic', divergentes: 2, itens: 3 },
    { fornecedor: 'Vishay', divergentes: 2, itens: 4 },
  ],
  semanas: [
    { inicio: '2026-09-07', justificadas: 1, semJustificativa: 1 },
    { inicio: '2026-09-14', justificadas: 0, semJustificativa: 0 },
  ],
}
const OPCOES = { fornecedores: ['Panasonic', 'Vishay'], compradores: [] }

beforeEach(() => {
  push.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('clicar num gráfico aplica o filtro e a tela inteira recalcula (pela URL)', () => {
  it('barra de fornecedor', () => {
    render(<DashboardRecebimento filtros={NOVENTA} dados={DADOS} opcoes={OPCOES} erro={null} />)
    fireEvent.click(screen.getByRole('button', { name: /^Vishay/ }))
    // O recorte padrão não vai para a URL.
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?fornecedor=Vishay')
  })
  it('semana', () => {
    render(<DashboardRecebimento filtros={NOVENTA} dados={DADOS} opcoes={OPCOES} erro={null} />)
    fireEvent.click(screen.getByRole('button', { name: /Semana de 07\/09\/2026/ }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?de=2026-09-07&ate=2026-09-13')
  })
  it('positivas / negativas', () => {
    render(<DashboardRecebimento filtros={NOVENTA} dados={DADOS} opcoes={OPCOES} erro={null} />)
    fireEvent.click(screen.getByRole('button', { name: /^Negativas/ }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?sinal=negativa')
  })
  it('Limpar filtros leva para "sem recorte nenhum"', () => {
    render(<DashboardRecebimento filtros={{ ...NOVENTA, fornecedor: 'Vishay' }} dados={DADOS} opcoes={OPCOES} erro={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?periodo=tudo')
  })
  it('a semana filtrada fica marcada no gráfico', () => {
    render(<DashboardRecebimento filtros={{ ...FILTROS_LIMPOS, de: '2026-09-07', ate: '2026-09-13' }} dados={DADOS} opcoes={OPCOES} erro={null} />)
    expect(screen.getByRole('button', { name: /Semana de 07\/09\/2026/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
