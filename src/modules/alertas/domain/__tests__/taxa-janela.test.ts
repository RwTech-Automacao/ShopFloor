import { describe, it, expect } from 'vitest'
import { taxaAprovacao, formatarTaxa, formatarMeta } from '../taxa'
import { textoJanela, resumoJanela } from '../janela'

describe('taxaAprovacao', () => {
  it('calcula o percentual exato de aprovação', () => {
    expect(taxaAprovacao(15, 5)).toBe(75)
  })
  it('devolve null quando não houve bipe aprovado nem reprovado', () => {
    expect(taxaAprovacao(0, 0)).toBeNull()
  })
  it('100% quando não houve reprova', () => {
    expect(taxaAprovacao(7, 0)).toBe(100)
  })
})

describe('formatarTaxa', () => {
  it('trunca na primeira casa decimal (não arredonda)', () => {
    // 236/270 = 87,407...% -> 87,4 ; 8/9 = 88,888...% -> 88,8 (arredondar daria 88,9)
    expect(formatarTaxa(236, 34)).toBe('87,4')
    expect(formatarTaxa(8, 1)).toBe('88,8')
  })
  it('mostra sempre uma casa decimal', () => {
    expect(formatarTaxa(1, 0)).toBe('100,0')
    expect(formatarTaxa(3, 1)).toBe('75,0')
  })
  it('sem bipes vira travessão', () => {
    expect(formatarTaxa(0, 0)).toBe('—')
  })
})

describe('formatarMeta', () => {
  it('inteiro sai sem casas', () => {
    expect(formatarMeta(90)).toBe('90')
  })
  it('decimal sai com vírgula e até 2 casas', () => {
    expect(formatarMeta(92.5)).toBe('92,5')
    expect(formatarMeta(99.95)).toBe('99,95')
  })
})

describe('textoJanela', () => {
  it('60 minutos vira "na última hora"', () => {
    expect(textoJanela({ tipo: 'tempo', valor: 60 })).toBe('na última hora')
  })
  it('outros minutos saem no plural', () => {
    expect(textoJanela({ tipo: 'tempo', valor: 90 })).toBe('nos últimos 90 minutos')
  })
  it('1 minuto sai no singular', () => {
    expect(textoJanela({ tipo: 'tempo', valor: 1 })).toBe('no último minuto')
  })
  it('bipes', () => {
    expect(textoJanela({ tipo: 'bipes', valor: 50 })).toBe('nos últimos 50 bipes')
  })
  it('op com PMO/OP conhecidos', () => {
    expect(textoJanela({ tipo: 'op', valor: null, pmo: 'PMOA', op: '1001' })).toBe('na OP PMOA/1001')
  })
  it('op sem PMO/OP cai no genérico', () => {
    expect(textoJanela({ tipo: 'op', valor: null, pmo: null, op: null })).toBe('na OP em andamento')
  })
})

describe('resumoJanela', () => {
  it('resume cada tipo para a coluna da tabela', () => {
    expect(resumoJanela({ tipo: 'tempo', valor: 60 })).toBe('Últimos 60 min')
    expect(resumoJanela({ tipo: 'bipes', valor: 50 })).toBe('Últimos 50 bipes')
    expect(resumoJanela({ tipo: 'op', valor: null })).toBe('OP em andamento')
  })
})
