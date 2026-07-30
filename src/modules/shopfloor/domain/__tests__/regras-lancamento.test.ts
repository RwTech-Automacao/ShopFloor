import { describe, it, expect } from 'vitest'
import { caixaCheia } from '../regras-lancamento'

describe('caixaCheia', () => {
  it('true quando count >= limite', () => {
    expect(caixaCheia(10, 10)).toBe(true)
    expect(caixaCheia(9, 10)).toBe(false)
    expect(caixaCheia(5, null)).toBe(false)
  })
})
