import { describe, it, expect } from 'vitest'
import { obrigatoriosPorPosto, caixaCheia } from '../regras-lancamento'

const base = { colaborador: 'x', pmo: 'P', op: 'O', numeroSerie: 'S1' }

describe('obrigatoriosPorPosto', () => {
  it('Inicial: exige campos base', () => {
    expect(obrigatoriosPorPosto('Inicial', base).ok).toBe(true)
    expect(obrigatoriosPorPosto('Inicial', { ...base, numeroSerie: '' }).ok).toBe(false)
  })
  it('Integração e Extra máquina: sem status, só base (não exige Status)', () => {
    expect(obrigatoriosPorPosto('Integração', base).ok).toBe(true)
    expect(obrigatoriosPorPosto('Extra máquina', base).ok).toBe(true)
    expect(obrigatoriosPorPosto('Extra máquina', { ...base, pmo: '' }).ok).toBe(false)
  })
  it('Embalagem: exige caixa e limite', () => {
    expect(obrigatoriosPorPosto('Embalagem', base).ok).toBe(false)
    expect(obrigatoriosPorPosto('Embalagem', { ...base, numeroCaixa: 'C1', limiteCaixa: '10' }).ok).toBe(true)
  })
  it('NQA: exige visual e funcional', () => {
    expect(obrigatoriosPorPosto('Inspeção NQA', base).ok).toBe(false)
    expect(obrigatoriosPorPosto('Inspeção NQA', { ...base, nqaVisual: 'Aprovado', nqaFuncional: 'Aprovado' }).ok).toBe(true)
  })
  it('NQA: funcional "Não aplicável" satisfaz o obrigatório (paridade com o legado)', () => {
    expect(obrigatoriosPorPosto('Inspeção NQA', { ...base, nqaVisual: 'Aprovado', nqaFuncional: 'Não aplicável' }).ok).toBe(true)
  })
  it('Teste reprovado: exige código, posição e tipo', () => {
    expect(obrigatoriosPorPosto('Teste', { ...base, status: 'Reprovado' }).ok).toBe(false)
    expect(obrigatoriosPorPosto('Teste', { ...base, status: 'Reprovado', cod: 'D', pos: 'R1', tipo: 'SMD' }).ok).toBe(true)
  })
  it('SPI: exige status; aprovado não pede defeito', () => {
    expect(obrigatoriosPorPosto('Inspeção SPI', base).ok).toBe(false)
    expect(obrigatoriosPorPosto('Inspeção SPI', { ...base, status: 'Aprovado' }).ok).toBe(true)
  })
  it('SPI reprovado: exige ao menos posição (só posição, sem cód/tipo)', () => {
    expect(obrigatoriosPorPosto('Inspeção SPI', { ...base, status: 'Reprovado' }).ok).toBe(false)
    expect(obrigatoriosPorPosto('Inspeção SPI', { ...base, status: 'Reprovado', pos: 'R7' }).ok).toBe(true)
  })
})

describe('caixaCheia', () => {
  it('true quando count >= limite', () => {
    expect(caixaCheia(10, 10)).toBe(true)
    expect(caixaCheia(9, 10)).toBe(false)
    expect(caixaCheia(5, null)).toBe(false)
  })
})
