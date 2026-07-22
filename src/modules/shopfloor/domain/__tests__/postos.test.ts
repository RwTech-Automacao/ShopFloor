import { describe, it, expect } from 'vitest'
import { postoAnteriorNaSequencia, gateSatisfeito } from '../postos'

describe('postoAnteriorNaSequencia', () => {
  const fluxo = ['Inicial', 'Inspeção SMD', 'Teste', 'Embalagem']
  it('devolve o posto imediatamente anterior na ordem da OP', () => {
    expect(postoAnteriorNaSequencia('Teste', fluxo)).toBe('Inspeção SMD')
    expect(postoAnteriorNaSequencia('Embalagem', fluxo)).toBe('Teste')
  })
  it('primeiro da lista não tem anterior', () => {
    expect(postoAnteriorNaSequencia('Inicial', fluxo)).toBeNull()
  })
  it('posto fora da lista → null', () => {
    expect(postoAnteriorNaSequencia('Burn-in', fluxo)).toBeNull()
  })
})

describe('gateSatisfeito', () => {
  it('Inicial/Integração/Embalagem: basta registrado', () => {
    expect(gateSatisfeito('Inicial', { Inicial: { registrado: true } })).toBe(true)
    expect(gateSatisfeito('Inicial', {})).toBe(false)
  })
  it('Montagem PTH: basta registrado', () => {
    expect(gateSatisfeito('Montagem PTH', { 'Montagem PTH': { registrado: true } })).toBe(true)
    expect(gateSatisfeito('Montagem PTH', { 'Montagem PTH': { aprovado: true } })).toBe(false)
  })
  it('Integração (com e sem acento): basta registrado', () => {
    expect(gateSatisfeito('Integração', { Integração: { registrado: true } })).toBe(true)
    expect(gateSatisfeito('Integracao', { Integracao: { registrado: true } })).toBe(true)
  })
  it('Embalagem: basta registrado (não exige aprovado)', () => {
    expect(gateSatisfeito('Embalagem', { Embalagem: { registrado: true } })).toBe(true)
    expect(gateSatisfeito('Embalagem', {})).toBe(false)
  })
  it('NQA e demais: exige aprovado', () => {
    expect(gateSatisfeito('Teste', { Teste: { registrado: true } })).toBe(false)
    expect(gateSatisfeito('Teste', { Teste: { aprovado: true } })).toBe(true)
    expect(gateSatisfeito('Inspeção NQA', { 'Inspeção NQA': { registrado: true } })).toBe(false)
    expect(gateSatisfeito('Inspeção NQA', { 'Inspeção NQA': { aprovado: true } })).toBe(true)
  })
})
