import { describe, it, expect } from 'vitest'
import { validarItensIntegracao } from '../integracao-itens'

const p = (pmo: string, op: string, sn: string) => ({ pmo, op, sn })

describe('validarItensIntegracao', () => {
  it('exige ao menos 1 placa não-vazia', () => {
    expect(validarItensIntegracao('900', []).ok).toBe(false)
    expect(validarItensIntegracao('900', [p('', '', '')]).ok).toBe(false)
  })
  it('linha com SN exige PMO e OP', () => {
    expect(validarItensIntegracao('900', [p('', '1', '100')]).ok).toBe(false)
    expect(validarItensIntegracao('900', [p('A', '', '100')]).ok).toBe(false)
  })
  it('linha iniciada (PMO/OP) mas SEM SN é barrada — não integra pela metade', () => {
    expect(validarItensIntegracao('900', [p('A', '1', '')]).ok).toBe(false)
    expect(validarItensIntegracao('900', [p('A', '1', '100'), p('B', '2', '')]).ok).toBe(false)
  })
  it('barra SN de placa repetido (normalizado)', () => {
    expect(validarItensIntegracao('900', [p('A', '1', '100'), p('B', '2', '0100')]).ok).toBe(false)
  })
  it('barra produto aparecendo como placa', () => {
    expect(validarItensIntegracao('900', [p('A', '1', '0900')]).ok).toBe(false)
  })
  it('ignora linha totalmente vazia (trailing) e devolve as preenchidas', () => {
    const r = validarItensIntegracao('900', [p('A', '1', '100'), p('', '', ''), p('C', '3', '200')])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.placas).toEqual([p('A', '1', '100'), p('C', '3', '200')])
  })
})
