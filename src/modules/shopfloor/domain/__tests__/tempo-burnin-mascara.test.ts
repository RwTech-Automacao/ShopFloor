import { describe, it, expect } from 'vitest'
import { mascararTempoAuto } from '../tempo-burnin'

describe('mascararTempoAuto', () => {
  it('returns empty string for empty input', () => {
    expect(mascararTempoAuto('')).toBe('')
  })

  it('returns empty string for non-digit input', () => {
    expect(mascararTempoAuto('abc')).toBe('')
  })

  it('returns single digit raw', () => {
    expect(mascararTempoAuto('2')).toBe('2')
  })

  it('returns two digits raw', () => {
    expect(mascararTempoAuto('23')).toBe('23')
  })

  it('formats three digits as h:mm', () => {
    expect(mascararTempoAuto('230')).toBe('2:30')
  })

  it('formats three digits starting with zero', () => {
    expect(mascararTempoAuto('023')).toBe('0:23')
  })

  it('formats three digits with zero minutes', () => {
    expect(mascararTempoAuto('200')).toBe('2:00')
  })

  it('formats four digits as hh:mm', () => {
    expect(mascararTempoAuto('1000')).toBe('10:00')
  })

  it('formats five digits as hhh:mm', () => {
    expect(mascararTempoAuto('10000')).toBe('100:00')
  })

  it('caps to 5 digits and formats', () => {
    expect(mascararTempoAuto('100000')).toBe('100:00')
  })

  it('strips colons from input and reformats', () => {
    expect(mascararTempoAuto('12:34')).toBe('12:34')
  })

  it('strips non-digit characters and keeps only digits', () => {
    expect(mascararTempoAuto('x9x9')).toBe('99')
  })
})
