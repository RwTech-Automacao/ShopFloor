import { describe, expect, it } from 'vitest'
import { opLiberada } from '../liberacao'

describe('opLiberada', () => {
  it('vazia, ausente ou só espaços = nenhuma OP liberada', () => {
    expect(opLiberada('8649', undefined)).toBe(false)
    expect(opLiberada('8649', '')).toBe(false)
    expect(opLiberada('8649', '  , ,')).toBe(false)
  })

  it('libera só as OPs da lista, com espaços e vírgulas sobrando', () => {
    const lista = ' 8649 , 8650,'
    expect(opLiberada('8649', lista)).toBe(true)
    expect(opLiberada(' 8650 ', lista)).toBe(true)
    expect(opLiberada('8651', lista)).toBe(false)
  })

  it('* libera todas', () => {
    expect(opLiberada('qualquer', '*')).toBe(true)
  })

  it('não confunde prefixo: 864 não é 8649', () => {
    expect(opLiberada('864', '8649')).toBe(false)
  })

  it('OP com sufixo é liberada pelo número que o Compels conhece', () => {
    expect(opLiberada('8682_F', '8682')).toBe(true)
    expect(opLiberada('8504_', '8504')).toBe(true)
    expect(opLiberada('8682_F', '8683')).toBe(false)
    expect(opLiberada('8682_F', '8682_F')).toBe(true)
  })

  it('OP que não é número no Compels (PMOC50_) só é liberada se estiver escrita igual', () => {
    expect(opLiberada('PMOC50_', '8504')).toBe(false)
    expect(opLiberada('PMOC50_', 'PMOC50_')).toBe(true)
  })
})
