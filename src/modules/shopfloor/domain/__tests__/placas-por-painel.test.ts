import { describe, it, expect } from 'vitest'
import { placasDosPaineis, paineisDasPlacas } from '../placas-por-painel'

describe('placas por painel', () => {
  it('multiplica painéis por placas', () => expect(placasDosPaineis(100, 50)).toBe(5000))
  it('divide placas em painéis exatos', () => expect(paineisDasPlacas(5000, 50)).toBe(100))
  it('null quando não divide exato', () => expect(paineisDasPlacas(5001, 50)).toBeNull())
  it('N=1 é identidade', () => {
    expect(placasDosPaineis(7, 1)).toBe(7)
    expect(paineisDasPlacas(7, 1)).toBe(7)
  })
})
