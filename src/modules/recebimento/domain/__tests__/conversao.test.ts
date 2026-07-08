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
  it('numero já numérico (xlsx) é usado direto', () => {
    expect(converterValor(1481, 'numero')).toEqual({ ok: true, valor: 1481 })
  })
  it('numero BR com separador de milhar: "1.500" → 1500', () => {
    expect(converterValor('1.500', 'numero')).toEqual({ ok: true, valor: 1500 })
  })
  it('numero BR milhar + decimal: "1.500,50" → 1500.5', () => {
    expect(converterValor('1.500,50', 'numero')).toEqual({ ok: true, valor: 1500.5 })
  })
  it('numero BR decimal simples: "10,5" → 10.5', () => {
    expect(converterValor('10,5', 'numero')).toEqual({ ok: true, valor: 10.5 })
  })
  it('data serial do Excel vira ISO', () => {
    const r = converterValor(46239, 'data')
    expect(r.ok).toBe(true)
    if (r.ok) expect(String(r.valor)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('data BR dd/mm/aaaa vira ISO correta (1º de junho, não janeiro)', () => {
    expect(converterValor('01/06/2024', 'data')).toEqual({ ok: true, valor: '2024-06-01' })
  })
  it('data BR com dia > 12 mapeia dia/mês corretamente', () => {
    expect(converterValor('25/06/2024', 'data')).toEqual({ ok: true, valor: '2024-06-25' })
  })
  it('data ISO aaaa-mm-dd é aceita', () => {
    expect(converterValor('2024-06-01', 'data')).toEqual({ ok: true, valor: '2024-06-01' })
  })
  it('data inexistente (31/02) é rejeitada', () => {
    expect(converterValor('31/02/2024', 'data').ok).toBe(false)
  })
  it('lista aceita valor existente e rejeita inexistente', () => {
    expect(converterValor('AVNET', 'lista', ['AVNET']).ok).toBe(true)
    expect(converterValor('X', 'lista', ['AVNET']).ok).toBe(false)
  })
  it('texto vazio vira null', () => {
    expect(converterValor('', 'texto')).toEqual({ ok: true, valor: null })
  })
})
