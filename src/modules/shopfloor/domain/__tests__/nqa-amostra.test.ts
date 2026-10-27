import { describe, it, expect } from 'vitest'
import { pecasPorSnMaisRecente, placasDasAmostras } from '../nqa-amostra'

describe('pecasPorSnMaisRecente', () => {
  it('vale a 1ª linha de cada SN (lista da mais recente para a mais antiga)', () => {
    const m = pecasPorSnMaisRecente([
      { numero_serie_norm: 'A', pecas: 50 },
      { numero_serie_norm: 'B', pecas: 50 },
      { numero_serie_norm: 'A', pecas: 1 },
    ])
    expect(m).toEqual({ A: 50, B: 50 })
  })
  it('pecas ausente vale 1', () => {
    expect(pecasPorSnMaisRecente([{ numero_serie_norm: 'A' }])).toEqual({ A: 1 })
  })
})

describe('placasDasAmostras', () => {
  it('N = 1: é o número de amostras (igual a antes)', () => {
    const pecas = { A: 1, B: 1, C: 1 }
    expect(placasDasAmostras([{ snNorm: 'A' }, { snNorm: 'B' }], pecas)).toBe(2)
  })
  it('N = 50: cada painel amostrado vale 50 placas', () => {
    const pecas = { A: 50, B: 50 }
    expect(placasDasAmostras([{ snNorm: 'A' }], pecas)).toBe(50)
    expect(placasDasAmostras([{ snNorm: 'A' }, { snNorm: 'B' }], pecas)).toBe(100)
  })
  it('SN sem peso conhecido (progresso salvo antes das placas) vale 1', () => {
    expect(placasDasAmostras([{ snNorm: 'A' }, { snNorm: 'Z' }], undefined)).toBe(2)
    expect(placasDasAmostras([{ snNorm: 'A' }, { snNorm: 'Z' }], { A: 50 })).toBe(51)
  })
  it('sem amostras: 0', () => {
    expect(placasDasAmostras([], { A: 50 })).toBe(0)
  })
})
