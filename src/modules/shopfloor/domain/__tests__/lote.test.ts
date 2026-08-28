import { describe, it, expect } from 'vitest'
import { acharPendente, jaResolvido, contarResolvidos, temPendentes } from '../lote'

const P = (snNorm: string) => ({ estado: 'pendente' as const, snNorm })
const R = (snNorm: string) => ({ estado: 'resolvido' as const, snNorm })

describe('helpers do lote', () => {
  it('acharPendente retorna o índice do placeholder pendente com o SN', () => {
    expect(acharPendente([R('A'), P('B'), P('C')], 'B')).toBe(1)
  })
  it('acharPendente ignora itens resolvidos e retorna -1 se não achar', () => {
    expect(acharPendente([R('A'), P('B')], 'A')).toBe(-1)
    expect(acharPendente([R('A'), P('B')], 'Z')).toBe(-1)
  })
  it('jaResolvido só considera itens resolvidos', () => {
    expect(jaResolvido([R('A'), P('B')], 'A')).toBe(true)
    expect(jaResolvido([R('A'), P('B')], 'B')).toBe(false)
  })
  it('contarResolvidos conta só os resolvidos', () => {
    expect(contarResolvidos([R('A'), P('B'), R('C')])).toBe(2)
  })
  it('temPendentes é true se houver ao menos um pendente', () => {
    expect(temPendentes([R('A'), P('B')])).toBe(true)
    expect(temPendentes([R('A'), R('C')])).toBe(false)
  })
})
