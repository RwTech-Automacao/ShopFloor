import { describe, it, expect } from 'vitest'
import { validarPadraoFluxo } from '../validar-padrao'

describe('validarPadraoFluxo', () => {
  it('exige nome', () => {
    expect(validarPadraoFluxo('', ['Teste']).ok).toBe(false)
    expect(validarPadraoFluxo('   ', ['Teste']).ok).toBe(false)
  })
  it('exige ao menos um posto', () => {
    expect(validarPadraoFluxo('Padrão X', []).ok).toBe(false)
  })
  it('aceita nome + postos', () => {
    expect(validarPadraoFluxo('Padrão X', ['Inicial', 'Teste']).ok).toBe(true)
  })
})
