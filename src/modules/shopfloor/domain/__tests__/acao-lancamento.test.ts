import { describe, it, expect } from 'vitest'
import { classificarAcao } from '../acao-lancamento'

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
