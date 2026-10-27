import { describe, it, expect } from 'vitest'
import { caixaCheia } from '../regras-lancamento'

describe('caixaCheia', () => {
  it('true quando count >= limite', () => {
    expect(caixaCheia(10, 10)).toBe(true)
    expect(caixaCheia(9, 10)).toBe(false)
    expect(caixaCheia(5, null)).toBe(false)
  })
  it('pecasDoBipe: recusa o painel que estoura o limite em placas', () => {
    expect(caixaCheia(450, 500, 50)).toBe(false) // 450 + 50 = 500: cabe
    expect(caixaCheia(500, 500, 50)).toBe(true)  // 11º painel
    expect(caixaCheia(500, 520, 50)).toBe(true)  // 550 > 520
    expect(caixaCheia(9, 10, 1)).toBe(false)
    expect(caixaCheia(10, 10, 1)).toBe(true)
    expect(caixaCheia(500, null, 50)).toBe(false)
  })
})
