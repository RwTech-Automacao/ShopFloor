import { describe, it, expect } from 'vitest'
import { formatarMmSs, lerMmSs, LIMITE_TEMPO_MAX_SEG } from '../tempo'

describe('formatarMmSs', () => {
  it('minutos e segundos com dois dígitos', () => {
    expect(formatarMmSs(120)).toBe('2:00')
    expect(formatarMmSs(65)).toBe('1:05')
    expect(formatarMmSs(5)).toBe('0:05')
    expect(formatarMmSs(3600)).toBe('60:00')
  })
  it('arredonda a fração de segundo pra cima (número maior é pior, aqui)', () => {
    expect(formatarMmSs(68.33)).toBe('1:09')
    expect(formatarMmSs(179.99)).toBe('3:00')
  })
  it('120 s exatos seguem "2:00"; 120,5 s já viram "2:01" (não esconde que passou do limite)', () => {
    expect(formatarMmSs(120)).toBe('2:00')
    expect(formatarMmSs(120.5)).toBe('2:01')
  })
  it('negativo ou inválido vira 0:00', () => {
    expect(formatarMmSs(-3)).toBe('0:00')
    expect(formatarMmSs(Number.NaN)).toBe('0:00')
  })
})

describe('lerMmSs', () => {
  it('lê m:ss', () => {
    expect(lerMmSs('2:00')).toBe(120)
    expect(lerMmSs(' 1:30 ')).toBe(90)
    expect(lerMmSs('0:45')).toBe(45)
    expect(lerMmSs('60:00')).toBe(3600)
  })
  it('número sozinho é minutos', () => {
    expect(lerMmSs('3')).toBe(180)
  })
  it('recusa fora do formato ou fora de 0:01–60:00', () => {
    for (const t of ['', '2:5', '2:60', '1:2:3', 'abc', '0:00', '60:01', '61', '-1:00', '2,5', null, undefined]) {
      expect(lerMmSs(t)).toBeNull()
    }
  })
  it('teto de 60 minutos', () => {
    expect(LIMITE_TEMPO_MAX_SEG).toBe(3600)
  })
})
