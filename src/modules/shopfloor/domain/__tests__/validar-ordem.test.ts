import { describe, it, expect } from 'vitest'
import { validarOrdem } from '../validar-ordem'

const base = { pmo: 'PMOF1', op: '100', cliente: 'Empresa 1', snIni: '', snFim: '' }

describe('validarOrdem', () => {
  it('aceita OP mínima (pmo, op, cliente)', () => {
    expect(validarOrdem(base).ok).toBe(true)
  })
  it('exige pmo, op e cliente', () => {
    expect(validarOrdem({ ...base, pmo: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, op: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, cliente: '  ' }).ok).toBe(false)
  })
  it('faixa de SN: início e fim juntos ou ambos vazios', () => {
    expect(validarOrdem({ ...base, snIni: '100', snFim: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, snIni: '', snFim: '200' }).ok).toBe(false)
    expect(validarOrdem({ ...base, snIni: '100', snFim: '200' }).ok).toBe(true)
  })
})
