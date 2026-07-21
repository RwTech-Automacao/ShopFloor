import { describe, it, expect } from 'vitest'
import { postoAnteriorExigido, gateSatisfeito } from '../postos'

const todosAplicaveis = () => true

describe('postoAnteriorExigido', () => {
  it('Manutenção não exige anterior', () => {
    expect(postoAnteriorExigido('Manutenção', todosAplicaveis)).toBeNull()
  })
  it('Inicial (primeiro) não exige anterior', () => {
    expect(postoAnteriorExigido('Inicial', todosAplicaveis)).toBeNull()
  })
  it('Teste exige o posto anterior aplicável', () => {
    expect(postoAnteriorExigido('Teste', todosAplicaveis)).toBe('Inspeção PTH')
  })
  it('pula os postos não-aplicáveis para trás', () => {
    const aplic = (p: string) => p !== 'Inspeção PTH' && p !== 'Inspeção SMD' && p !== 'Montagem PTH'
    expect(postoAnteriorExigido('Teste', aplic)).toBe('Inspeção SPI')
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
