import { describe, it, expect } from 'vitest'
import { tempoParaMinutos, minutosParaTempo, formatarDuracao } from '../tempo-burnin'

describe('tempoParaMinutos', () => {
  it('vazio → 0 (sem mínimo)', () => { expect(tempoParaMinutos('')).toBe(0); expect(tempoParaMinutos('   ')).toBe(0) })
  it('hh:mm válido', () => {
    expect(tempoParaMinutos('2:00')).toBe(120)
    expect(tempoParaMinutos('02:00')).toBe(120)
    expect(tempoParaMinutos('1:05')).toBe(65)
    expect(tempoParaMinutos('48:00')).toBe(2880) // > 24h permitido
    expect(tempoParaMinutos('0:30')).toBe(30)
  })
  it('formato inválido → null', () => {
    expect(tempoParaMinutos('abc')).toBeNull()
    expect(tempoParaMinutos('1:60')).toBeNull() // minutos > 59
    expect(tempoParaMinutos('1:5')).toBe(65)    // 1 dígito de minuto é aceito (5 = 05)
    expect(tempoParaMinutos('2')).toBeNull()    // sem ':'
    expect(tempoParaMinutos('-1:00')).toBeNull()
  })
})

describe('minutosParaTempo', () => {
  it('minutos → hh:mm', () => {
    expect(minutosParaTempo(120)).toBe('2:00')
    expect(minutosParaTempo(65)).toBe('1:05')
    expect(minutosParaTempo(0)).toBe('0:00')
    expect(minutosParaTempo(2880)).toBe('48:00')
  })
})

describe('formatarDuracao', () => {
  it('legível pro aviso', () => {
    expect(formatarDuracao(95)).toBe('1h 35min')
    expect(formatarDuracao(40)).toBe('40min')
    expect(formatarDuracao(120)).toBe('2h')
    expect(formatarDuracao(0)).toBe('0min')
  })
})
