import { describe, expect, it } from 'vitest'
import { semSufixo } from '../sem-sufixo'

describe('semSufixo', () => {
  it('tira "_" e letras do fim da OP e da PMO', () => {
    expect(semSufixo('8682_F')).toBe('8682')
    expect(semSufixo('PMOF52_F')).toBe('PMOF52')
    expect(semSufixo('8504_')).toBe('8504')
    expect(semSufixo('PMOC50_')).toBe('PMOC50')
    expect(semSufixo('8682_FG')).toBe('8682')
  })

  it('sem sufixo, devolve igual (aparado)', () => {
    expect(semSufixo('8682')).toBe('8682')
    expect(semSufixo(' 8682 ')).toBe('8682')
  })

  it('só o sufixo do FIM: "_" no meio e dígitos depois do "_" ficam', () => {
    expect(semSufixo('AB_CD12')).toBe('AB_CD12')
    expect(semSufixo('8682_2')).toBe('8682_2')
    expect(semSufixo('A_B_C')).toBe('A_B')
  })
})
