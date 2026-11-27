import { describe, expect, it } from 'vitest'
import { avisoReceitaPrtLimpa, codigosPrt, limparReceitaPrt, mensagemPlacaPrtIncompleta, prtsDeMesmaSerie, prtsDeSeriePropria, receitaSemPrt } from '../receita-prt'

const T = (codigo: string, tipo: 'prt' | 'pmo', snModo: 'mesmo' | 'proprio' = 'mesmo') => ({ codigo, tipo, snModo })
const TRECHOS = [T('PRT410', 'prt', 'proprio'), T('PRT420', 'prt', 'mesmo'), T('PRT430', 'prt', 'proprio'), T('PMOC14', 'pmo')]

describe('prtsDeSeriePropria', () => {
  it('só as PRTs de série própria, na ordem, sem repetir', () => {
    expect(prtsDeSeriePropria(TRECHOS)).toEqual(['PRT410', 'PRT430'])
    expect(prtsDeSeriePropria([...TRECHOS, T('prt410', 'prt', 'proprio')])).toEqual(['PRT410', 'PRT430'])
  })
  it('OP sem trechos PRT (ou só com a mesma série): nenhuma', () => {
    expect(prtsDeSeriePropria([T('PMOC14', 'pmo')])).toEqual([])
    expect(prtsDeSeriePropria([T('PRT420', 'prt'), T('PMOC14', 'pmo')])).toEqual([])
    expect(codigosPrt(TRECHOS)).toEqual(['PRT410', 'PRT420', 'PRT430'])
  })
  it('prtsDeMesmaSerie: as PRTs com a série da PMO, sem repetir', () => {
    expect(prtsDeMesmaSerie(TRECHOS)).toEqual(['PRT420'])
    expect(prtsDeMesmaSerie([T('PMOC14', 'pmo')])).toEqual([])
  })
})

describe('limparReceitaPrt', () => {
  it('receita só de PMOs não muda (a mesma referência)', () => {
    const r = { Integração: ['PMOX', 'PMOY'] }
    const out = limparReceitaPrt(r, TRECHOS, ['PRT999'], ['PMOX'])
    expect(out.receita).toBe(r)
    expect(out.removidas).toEqual([])
  })
  it('a PRT com a mesma série da PMO sai; a de série própria fica', () => {
    const out = limparReceitaPrt({ Integração: ['PMOX', 'prt420', 'PRT410'], 'Integração 2': ['PRT420'] }, TRECHOS)
    expect(out.receita).toEqual({ Integração: ['PMOX', 'PRT410'], 'Integração 2': [] })
    expect(out.removidas).toEqual(['prt420'])
  })
  it('a PRT que saiu da estrutura sai, a não ser que também seja uma PMO válida', () => {
    const out = limparReceitaPrt({ Integração: ['PRT999', 'PRT706', 'PMOX'] }, TRECHOS, ['PRT999', 'PRT706'], ['PMOX', 'PRT706'])
    expect(out.receita).toEqual({ Integração: ['PRT706', 'PMOX'] })
    expect(out.removidas).toEqual(['PRT999'])
  })
  it('a PRT de mesma série que também é PMO de uma OP cadastrada fica (vale como PMO), sem aviso', () => {
    const r = { Integração: ['PRT420', 'PMOX'] }
    const out = limparReceitaPrt(r, TRECHOS, ['PRT420'], ['PRT420', 'PMOX'])
    expect(out.receita).toBe(r)
    expect(out.removidas).toEqual([])
  })
  it('código que a tela nunca viu como PRT segue como PMO', () => {
    expect(limparReceitaPrt({ Integração: ['PMOVELHA'] }, TRECHOS, [], []).removidas).toEqual([])
  })
})

describe('mensagens', () => {
  it('aviso da limpeza, no singular e no plural', () => {
    expect(avisoReceitaPrtLimpa([])).toBeNull()
    expect(avisoReceitaPrtLimpa(['PRT420'])).toBe('PRT420 saiu da receita da Integração: ela não é mais uma PRT de série própria desta OP.')
    expect(avisoReceitaPrtLimpa(['PRT420', 'PRT999'])).toBe('PRT420, PRT999 saíram da receita da Integração: elas não são mais PRTs de série própria desta OP.')
  })
  it('placa que não terminou a PRT', () => {
    expect(mensagemPlacaPrtIncompleta('A001', 'PRT410', 'Inspeção AOI TOP'))
      .toBe('A placa A001 ainda não terminou a PRT410 (falta o posto Inspeção AOI TOP).')
  })
})

describe('receitaSemPrt', () => {
  it('tira a PRT ignorada de todo posto, sem mexer nas outras', () => {
    const r = { Integracao: ['PMO1', 'prt420 ', 'PRT410'], Outro: ['PRT420'] }
    expect(receitaSemPrt(r, 'PRT420')).toEqual({ Integracao: ['PMO1', 'PRT410'], Outro: [] })
  })
  it('sem a PRT na receita devolve a mesma referência', () => {
    const r = { Integracao: ['PMO1'] }
    expect(receitaSemPrt(r, 'PRT420')).toBe(r)
    expect(receitaSemPrt(r, '')).toBe(r)
  })
})
