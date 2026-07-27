import { describe, it, expect } from 'vitest'
import { postoAnteriorNaSequencia } from '../postos'

describe('postoAnteriorNaSequencia', () => {
  const fluxo = ['Inicial', 'Inspeção SMD', 'Teste', 'Embalagem']
  it('devolve o posto imediatamente anterior na ordem da OP', () => {
    expect(postoAnteriorNaSequencia('Teste', fluxo)).toBe('Inspeção SMD')
    expect(postoAnteriorNaSequencia('Embalagem', fluxo)).toBe('Teste')
  })
  it('primeiro da lista não tem anterior', () => {
    expect(postoAnteriorNaSequencia('Inicial', fluxo)).toBeNull()
  })
  it('posto fora da lista → null', () => {
    expect(postoAnteriorNaSequencia('Burn-in', fluxo)).toBeNull()
  })
})
