import { describe, expect, it } from 'vitest'
import { ehRotaDaBaixaDeNf } from '../rotas-baixa-nf'

describe('ehRotaDaBaixaDeNf', () => {
  it('só a rota exata (com ou sem barra final) sai da sessão', () => {
    expect(ehRotaDaBaixaDeNf('/api/compels/baixa-nf')).toBe(true)
    expect(ehRotaDaBaixaDeNf('/api/compels/baixa-nf/')).toBe(true)
    expect(ehRotaDaBaixaDeNf('/api/compels/baixa-nf/x')).toBe(false)
    expect(ehRotaDaBaixaDeNf('/api/compels/baixa-nf-x')).toBe(false)
    expect(ehRotaDaBaixaDeNf('/api/compels')).toBe(false)
  })
})
