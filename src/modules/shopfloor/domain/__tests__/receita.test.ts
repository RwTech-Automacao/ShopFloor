import { describe, it, expect } from 'vitest'
import { receitaPermite } from '../receita'

describe('receitaPermite', () => {
  it('receita vazia libera qualquer PMO', () => {
    expect(receitaPermite([], 'PMO21')).toBe(true)
  })
  it('permite PMO na receita e barra fora dela', () => {
    expect(receitaPermite(['PMO21', 'PMO22'], 'PMO21')).toBe(true)
    expect(receitaPermite(['PMO21', 'PMO22'], 'PMO99')).toBe(false)
  })
  it('compara sem diferenciar maiúsculas/minúsculas e espaços', () => {
    expect(receitaPermite([' pmo21 '], 'PMO21')).toBe(true)
    expect(receitaPermite(['PMO21'], 'pmo21')).toBe(true)
  })
})
