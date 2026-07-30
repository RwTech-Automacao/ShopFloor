import { describe, it, expect } from 'vitest'
import { normalizarCodigoDefeito, validarDefeito } from '../defeito'

describe('normalizarCodigoDefeito', () => {
  it('faz trim, colapsa espaços internos e força maiúsculas', () => {
    expect(normalizarCodigoDefeito('  1002   trilha rompida  ')).toBe('1002 TRILHA ROMPIDA')
  })
  it('string vazia/só espaços vira vazio', () => {
    expect(normalizarCodigoDefeito('   ')).toBe('')
  })
})

describe('validarDefeito', () => {
  it('aceita código válido + tipo peça, devolvendo o código normalizado', () => {
    const r = validarDefeito({ codigo: ' 1010 solda fria ', tipo: 1 })
    expect(r).toEqual({ ok: true, valor: { codigo: '1010 SOLDA FRIA', tipo: 1 } })
  })
  it('aceita tipo teste (2)', () => {
    const r = validarDefeito({ codigo: '2001 falha', tipo: 2 })
    expect(r.ok && r.valor.tipo).toBe(2)
  })
  it('rejeita código vazio', () => {
    expect(validarDefeito({ codigo: '   ', tipo: 1 })).toEqual({
      ok: false,
      erro: 'Informe o código do defeito.',
    })
  })
  it('rejeita tipo fora de {1,2}', () => {
    expect(validarDefeito({ codigo: '1010 x', tipo: 0 })).toEqual({
      ok: false,
      erro: 'Selecione o tipo (peça ou teste).',
    })
    expect(validarDefeito({ codigo: '1010 x', tipo: 3 }).ok).toBe(false)
    expect(validarDefeito({ codigo: '1010 x', tipo: Number.NaN }).ok).toBe(false)
  })
})
