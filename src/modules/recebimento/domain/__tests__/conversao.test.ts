import { describe, it, expect } from 'vitest'
import { converterValor } from '../conversao'

describe('converterValor', () => {
  it('numero válido', () => {
    expect(converterValor('1481', 'numero')).toEqual({ ok: true, valor: 1481 })
  })
  it('numero inválido', () => {
    const r = converterValor('abc', 'numero')
    expect(r.ok).toBe(false)
  })
  it('data serial do Excel vira ISO', () => {
    const r = converterValor(46239, 'data')
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.valor)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('lista aceita valor existente e rejeita inexistente', () => {
    expect(converterValor('AVNET', 'lista', ['AVNET']).ok).toBe(true)
    expect(converterValor('X', 'lista', ['AVNET']).ok).toBe(false)
  })
  it('texto vazio vira null', () => {
    expect(converterValor('', 'texto')).toEqual({ ok: true, valor: null })
  })
})
