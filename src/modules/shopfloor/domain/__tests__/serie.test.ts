import { describe, it, expect } from 'vitest'
import { normalizarSerie, limparSerie, partesSerie, serieDentroDaFaixa } from '../serie'

describe('normalizarSerie', () => {
  it('remove separadores, zeros à esquerda e caixa', () => {
    expect(normalizarSerie('00-25 7891/001')).toBe('257891001'.replace(/^0+/, ''))
    expect(normalizarSerie('AB007')).toBe('ab007'.replace(/^0+/, '')) // sem zeros no meio de letras
  })
})

describe('limparSerie', () => {
  it('remove separadores mas mantém zeros à esquerda', () => {
    expect(limparSerie('00-25.7891/001')).toBe('00257891001')
  })
})

describe('partesSerie', () => {
  it('separa prefixo/dígitos/sufixo', () => {
    expect(partesSerie('AB0123C')).toEqual({ limpo: 'AB0123C', prefixo: 'AB', num: 123, sufixo: 'C', largura: 4 })
  })
  it('num = NaN quando não há bloco único de dígitos', () => {
    expect(partesSerie('12AB34').num).toBeNaN()
  })
})

describe('serieDentroDaFaixa', () => {
  it('numérica dentro/fora', () => {
    expect(serieDentroDaFaixa('2576940001', '2576940301', '2576940050')).toBe(true)
    expect(serieDentroDaFaixa('2576940001', '2576940301', '2576940999')).toBe(false)
  })
  it('exige mesmo prefixo e sufixo', () => {
    expect(serieDentroDaFaixa('A100C', 'A200C', 'B150C')).toBe(false) // prefixo diferente
    expect(serieDentroDaFaixa('A100C', 'A200C', 'A150D')).toBe(false) // sufixo diferente
    expect(serieDentroDaFaixa('A100C', 'A200C', 'A150C')).toBe(true)
  })
  it('fallback lexical quando não há bloco único de dígitos', () => {
    // SNs sem número (num = NaN) → comparação lexical entre início e fim
    expect(serieDentroDaFaixa('ABC', 'ABZ', 'ABM')).toBe(true)
    expect(serieDentroDaFaixa('ABC', 'ABZ', 'AAA')).toBe(false)
  })
})
