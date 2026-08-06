import { describe, it, expect } from 'vitest'
import { classificarAcao, defeitosDoPosto, DEFEITOS_SPI } from '../acao-lancamento'

const cat = [{ codigo: '101 NÃO LIGA', tipo: 2 }, { codigo: '2002 TOMBSTONE', tipo: 1 }]

describe('classificarAcao', () => {
  it('SN na faixa → aprovado', () => {
    expect(classificarAcao('2659381010', cat, '2659381000', '2659381999')).toEqual({ tipo: 'aprovado' })
  })
  it('código do catálogo (normalizado) → reprovado', () => {
    expect(classificarAcao(' 101  não liga ', cat, '2659381000', '2659381999')).toEqual({ tipo: 'reprovado', codigo: '101 NÃO LIGA' })
  })
  it('fora da faixa e fora do catálogo → invalido', () => {
    expect(classificarAcao('XYZ', cat, '2659381000', '2659381999')).toEqual({ tipo: 'invalido' })
  })
  it('defeito tem prioridade sobre faixa (não colidem na prática)', () => {
    expect(classificarAcao('2002 TOMBSTONE', cat, '0000000000', '9999999999')).toEqual({ tipo: 'reprovado', codigo: '2002 TOMBSTONE' })
  })
})

describe('defeitosDoPosto', () => {
  const catalogoGeral = [{ codigo: '101 X', tipo: 2 }]
  it('spi → lista fixa de solda', () => {
    expect(defeitosDoPosto('spi', catalogoGeral)).toBe(DEFEITOS_SPI)
    expect(DEFEITOS_SPI.map((d) => d.codigo)).toContain('CURTO')
  })
  it('outros → catálogo geral', () => {
    expect(defeitosDoPosto('inspecao', catalogoGeral)).toBe(catalogoGeral)
  })
})

describe('classificarAcao com DEFEITOS_SPI', () => {
  it('SPI: código de solda → reprovado', () => {
    expect(classificarAcao('curto', DEFEITOS_SPI, '2659381000', '2659381999')).toEqual({ tipo: 'reprovado', codigo: 'CURTO' })
  })
})
