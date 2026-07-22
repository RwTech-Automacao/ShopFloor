import { describe, it, expect } from 'vitest'
import { postoTemStatus, precisaAprovado, montarLinhas } from '../lancamento-linhas'

describe('postoTemStatus', () => {
  it('classifica com/sem status', () => {
    expect(postoTemStatus('Teste')).toBe(true)
    expect(postoTemStatus('Inspeção SMD')).toBe(true)
    expect(postoTemStatus('Burn-in')).toBe(true)
    expect(postoTemStatus('Inspeção NQA')).toBe(true)
    expect(postoTemStatus('Inicial')).toBe(false)
    expect(postoTemStatus('Embalagem')).toBe(false)
    expect(postoTemStatus('Extra máquina')).toBe(false)
  })
})

describe('precisaAprovado', () => {
  it('sem status → basta registrado; demais → aprovado', () => {
    expect(precisaAprovado('Inicial')).toBe(false)
    expect(precisaAprovado('Embalagem')).toBe(false)
    expect(precisaAprovado('Extra máquina')).toBe(false)
    expect(precisaAprovado('Teste')).toBe(true)
    expect(precisaAprovado('Burn-in')).toBe(true)
    expect(precisaAprovado('Inspeção NQA')).toBe(true)
  })
})

describe('montarLinhas', () => {
  it('aprovado / sem defeito → vazio', () => {
    expect(montarLinhas('Teste', { status: 'Aprovado', defeitos: [] })).toEqual([])
    expect(montarLinhas('Inicial', {})).toEqual([])
  })
  it('reprovado com N defeitos → 1 linha por defeito', () => {
    const r = montarLinhas('Teste', {
      status: 'Reprovado',
      defeitos: [
        { codigo: '1002', posicao: 'R1', tipo: 'SMD' },
        { codigo: '1003', posicao: 'C4', tipo: 'PTH' },
      ],
    })
    expect(r).toEqual([
      { codigo_defeito: '1002', posicao: 'R1', tipo_defeito: 'SMD' },
      { codigo_defeito: '1003', posicao: 'C4', tipo_defeito: 'PTH' },
    ])
  })
  it('SPI reprovado → 1 linha por posição (sem código/tipo)', () => {
    const r = montarLinhas('Inspeção SPI', { status: 'Reprovado', posicoes: ['R1', 'R2'] })
    expect(r).toEqual([
      { codigo_defeito: '', posicao: 'R1', tipo_defeito: '' },
      { codigo_defeito: '', posicao: 'R2', tipo_defeito: '' },
    ])
  })
})
