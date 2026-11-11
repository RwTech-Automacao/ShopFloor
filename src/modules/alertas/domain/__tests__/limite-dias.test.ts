import { describe, it, expect } from 'vitest'
import { LIMITE_DIAS_MAX, diasIniciaisDoLimite, horasDoLimiteEmDias } from '../limite-dias'

describe('limite do parado em dias', () => {
  it('o teto em dias é o teto em horas (720 h) dividido por 24', () => {
    expect(LIMITE_DIAS_MAX).toBe(30)
  })

  it('valor salvo múltiplo de 24 abre em dias exatos, sem aviso', () => {
    expect(diasIniciaisDoLimite(24)).toEqual({ dias: '1', horasArredondadas: null })
    expect(diasIniciaisDoLimite(120)).toEqual({ dias: '5', horasArredondadas: null })
    expect(diasIniciaisDoLimite(720)).toEqual({ dias: '30', horasArredondadas: null })
  })

  it('valor salvo que não fecha em dias abre arredondado PARA CIMA, com as horas salvas para o aviso', () => {
    expect(diasIniciaisDoLimite(6)).toEqual({ dias: '1', horasArredondadas: 6 })
    expect(diasIniciaisDoLimite(30)).toEqual({ dias: '2', horasArredondadas: 30 })
    expect(diasIniciaisDoLimite(167)).toEqual({ dias: '7', horasArredondadas: 167 })
  })

  it('dias digitados viram horas (dias × 24), só inteiros de 1 a 30', () => {
    expect(horasDoLimiteEmDias('1')).toBe(24)
    expect(horasDoLimiteEmDias(' 5 ')).toBe(120)
    expect(horasDoLimiteEmDias('30')).toBe(720)
    for (const ruim of ['', '0', '-1', '31', '1,5', '1.5', 'abc', '2d']) {
      expect(horasDoLimiteEmDias(ruim)).toBeNull()
    }
  })
})
