import { describe, it, expect } from 'vitest'
import { mascararTempoFiltro } from '../tempo-burnin'

describe('mascararTempoFiltro', () => {
  it('returns empty string for empty input', () => {
    expect(mascararTempoFiltro('')).toBe('')
  })

  it('returns empty string for non-digit input', () => {
    expect(mascararTempoFiltro('abc')).toBe('')
  })

  it('keeps valid hh:mm unchanged', () => {
    expect(mascararTempoFiltro('59:59')).toBe('59:59')
  })

  it('keeps two-digit hours unchanged (no clamping)', () => {
    expect(mascararTempoFiltro('70:00')).toBe('70:00')
  })

  it('keeps three-digit hours unchanged', () => {
    expect(mascararTempoFiltro('070:00')).toBe('070:00')
  })

  it('keeps default-like value unchanged', () => {
    expect(mascararTempoFiltro('06:00')).toBe('06:00')
  })

  it('keeps single-digit hour unchanged', () => {
    expect(mascararTempoFiltro('0:30')).toBe('0:30')
  })

  it('caps hours to 3 digits when no colon typed', () => {
    expect(mascararTempoFiltro('5445645645')).toBe('544')
  })

  it('caps hours to 3 and minutes to 2 when colon typed', () => {
    expect(mascararTempoFiltro('1234:567')).toBe('123:56')
  })

  it('keeps only the first colon', () => {
    expect(mascararTempoFiltro('1:2:3')).toBe('1:23')
  })

  it('keeps trailing colon with empty minutes', () => {
    expect(mascararTempoFiltro('12:')).toBe('12:')
  })

  it('strips letters interspersed with digits and colon', () => {
    expect(mascararTempoFiltro('1a2:3b4')).toBe('12:34')
  })
})
