import { describe, it, expect } from 'vitest'
import { ITENS_REPINMETRO, classeResultado } from '../repinmetro'

describe('repinmetro', () => {
  it('tem os 15 itens de teste, com chaves únicas', () => {
    expect(ITENS_REPINMETRO).toHaveLength(15)
    const chaves = new Set(ITENS_REPINMETRO.map((i) => i.chave))
    expect(chaves.size).toBe(15)
  })

  it('classifica o resultado por prefixo (case/espaço-insensível)', () => {
    expect(classeResultado('APROVADO')).toBe('aprovado')
    expect(classeResultado(' aprov. ')).toBe('aprovado')
    expect(classeResultado('REPROVADO')).toBe('reprovado')
    expect(classeResultado('NA')).toBe('na')
    expect(classeResultado('')).toBe('na')
    expect(classeResultado(null)).toBe('na')
    expect(classeResultado(undefined)).toBe('na')
  })
})
