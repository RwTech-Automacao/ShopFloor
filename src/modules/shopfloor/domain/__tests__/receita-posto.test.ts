import { describe, it, expect } from 'vitest'
import {
  agruparReceitaPorPosto,
  receitaParaLinhas,
  parseReceitaPorPosto,
  coagirReceitaPadrao,
} from '../receita-posto'

describe('agruparReceitaPorPosto', () => {
  it('agrupa linhas por posto preservando ordem e sem duplicar', () => {
    const linhas = [
      { posto: 'Integração', pmo_componente: 'PMOA' },
      { posto: 'Integração', pmo_componente: 'PMOB' },
      { posto: 'Teste Integração', pmo_componente: 'PMOC' },
      { posto: 'Integração', pmo_componente: 'PMOA' },
    ]
    expect(agruparReceitaPorPosto(linhas)).toEqual({
      'Integração': ['PMOA', 'PMOB'],
      'Teste Integração': ['PMOC'],
    })
  })
  it('lista vazia → objeto vazio', () => {
    expect(agruparReceitaPorPosto([])).toEqual({})
  })
})

describe('receitaParaLinhas', () => {
  it('achata o mapa em linhas {posto,pmo}', () => {
    expect(receitaParaLinhas({ 'Integração': ['PMOA', 'PMOB'], 'Teste Integração': ['PMOC'] })).toEqual([
      { posto: 'Integração', pmo: 'PMOA' },
      { posto: 'Integração', pmo: 'PMOB' },
      { posto: 'Teste Integração', pmo: 'PMOC' },
    ])
  })
})

describe('parseReceitaPorPosto', () => {
  it('mantém só postos de integração e remove PMO vazia/duplicada (case-insensitive)', () => {
    const json = JSON.stringify({
      'Integração': ['PMOA', 'pmoa', '', 'PMOB'],
      'Teste Integração': ['PMOC'],
      'Teste': ['PMOX'],
    })
    expect(parseReceitaPorPosto(json, ['Integração', 'Teste Integração'])).toEqual({
      'Integração': ['PMOA', 'PMOB'],
      'Teste Integração': ['PMOC'],
    })
  })
  it('JSON inválido ou array → objeto vazio', () => {
    expect(parseReceitaPorPosto('nope', ['Integração'])).toEqual({})
    expect(parseReceitaPorPosto('[]', ['Integração'])).toEqual({})
  })
  it('posto sem PMO válida some do resultado', () => {
    expect(parseReceitaPorPosto(JSON.stringify({ 'Integração': ['', '  '] }), ['Integração'])).toEqual({})
  })
})

describe('coagirReceitaPadrao', () => {
  it('array legado vira receita do posto Integração', () => {
    expect(coagirReceitaPadrao(['PMOA', 'PMOB'])).toEqual({ 'Integração': ['PMOA', 'PMOB'] })
  })
  it('objeto é mantido (limpando PMOs vazias)', () => {
    expect(coagirReceitaPadrao({ 'Integração': ['PMOA', ''], 'Teste Integração': ['PMOC'] })).toEqual({
      'Integração': ['PMOA'],
      'Teste Integração': ['PMOC'],
    })
  })
  it('array vazio / valor inesperado → objeto vazio', () => {
    expect(coagirReceitaPadrao([])).toEqual({})
    expect(coagirReceitaPadrao(null)).toEqual({})
  })
})
