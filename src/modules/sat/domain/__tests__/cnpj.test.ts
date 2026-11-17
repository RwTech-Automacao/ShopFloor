import { describe, expect, it } from 'vitest'
import { digitosCnpj, formatarCnpj } from '../cnpj'

describe('digitosCnpj', () => {
  it('fica só com os dígitos', () => {
    expect(digitosCnpj('12.345.678/0001-90')).toBe('12345678000190')
    expect(digitosCnpj(' 123.456.789-09 ')).toBe('12345678909')
    expect(digitosCnpj('')).toBe('')
    expect(digitosCnpj(undefined as never)).toBe('')
  })
})

describe('formatarCnpj', () => {
  it('14 dígitos: máscara de CNPJ', () => {
    expect(formatarCnpj('12345678000190')).toBe('12.345.678/0001-90')
    expect(formatarCnpj('12.345.678/0001-90')).toBe('12.345.678/0001-90')
    expect(formatarCnpj('12 345 678 0001 90')).toBe('12.345.678/0001-90')
  })
  it('11 dígitos: máscara de CPF', () => {
    expect(formatarCnpj('12345678909')).toBe('123.456.789-09')
  })
  it('outra quantidade de dígitos: null', () => {
    expect(formatarCnpj('')).toBeNull()
    expect(formatarCnpj('1234567800019')).toBeNull()
    expect(formatarCnpj('123456780001901')).toBeNull()
    expect(formatarCnpj('abc')).toBeNull()
  })
})
