import { describe, it, expect } from 'vitest'
import { formatarValorOcorrencia, textoPreviaPosto, type PreviaPosto } from '../ocorrencia'
import { formatarTaxaValor } from '../taxa'

const P: PreviaPosto = {
  posto: 'Teste',
  defeito: null,
  aprovados: 0,
  reprovados: 0,
  taxa: null,
  mediaSeg: null,
  intervalos: 0,
  pecas: 0,
  ocorrencias: 0,
  avaliavel: false,
  pmo: null,
  op: null,
}

describe('formatarTaxaValor', () => {
  it('1 casa truncada, sem erro de ponto flutuante', () => {
    expect(formatarTaxaValor(88.88)).toBe('88,8')
    expect(formatarTaxaValor(75)).toBe('75,0')
    expect(formatarTaxaValor(0.29)).toBe('0,2')
    expect(formatarTaxaValor(99.99)).toBe('99,9')
  })
})

describe('formatarValorOcorrencia', () => {
  it('por tipo', () => {
    expect(formatarValorOcorrencia('aprovacao', 88.88)).toBe('88,8%')
    expect(formatarValorOcorrencia('tempo', 180)).toBe('3:00/peça')
    expect(formatarValorOcorrencia('defeito', 4)).toBe('4 vezes')
    expect(formatarValorOcorrencia('defeito', 1)).toBe('1 vez')
  })
  it('sem valor', () => {
    expect(formatarValorOcorrencia('tempo', null)).toBe('—')
  })
})

describe('textoPreviaPosto', () => {
  it('taxa de aprovação', () => {
    expect(textoPreviaPosto('aprovacao', { ...P, aprovados: 15, reprovados: 5, taxa: 75, avaliavel: true }, null)).toBe(
      'Teste: 75,0% (15 aprovados, 5 reprovados)',
    )
    expect(textoPreviaPosto('aprovacao', { ...P, aprovados: 3, reprovados: 1 }, null)).toBe(
      'Teste: bipes insuficientes na janela (4)',
    )
  })
  it('tempo médio por peça', () => {
    expect(textoPreviaPosto('tempo', { ...P, mediaSeg: 68.33, intervalos: 29, pecas: 30, avaliavel: true }, null)).toBe(
      'Teste: 1:09 por peça (29 intervalos, 30 peças)',
    )
    expect(textoPreviaPosto('tempo', { ...P, intervalos: 3, pecas: 4 }, null)).toBe(
      'Teste: intervalos insuficientes na janela (3)',
    )
  })
  it('defeito repetido', () => {
    expect(
      textoPreviaPosto('defeito', { ...P, defeito: '2040 COMPONENTE FALTANDO', ocorrencias: 3, avaliavel: true }, 3),
    ).toBe('Teste: 2040 (Componente Faltando) — 3 vezes')
    expect(textoPreviaPosto('defeito', { ...P, avaliavel: true }, 5)).toBe(
      'Teste: nenhum defeito repetido 5 vezes ou mais',
    )
  })
})
