import { describe, it, expect } from 'vitest'
import {
  diferencaDias,
  diferencaNumerica,
  buscarCriticidade,
  buscarNqa,
  calcularCamposCalculados,
  type CampoCalc,
} from '../calculos'

describe('diferencaDias', () => {
  it('positivo quando chegou depois', () => {
    expect(diferencaDias('2026-06-10', '2026-06-05')).toBe(5)
  })
  it('negativo quando chegou antes', () => {
    expect(diferencaDias('2026-06-03', '2026-06-05')).toBe(-2)
  })
  it('null quando falta uma data', () => {
    expect(diferencaDias(null, '2026-06-05')).toBeNull()
  })
})
describe('diferencaNumerica', () => {
  it('subtrai', () => { expect(diferencaNumerica(8, 10)).toBe(-2) })
  it('null quando falta um valor', () => { expect(diferencaNumerica(null, 10)).toBeNull() })
})
describe('buscarCriticidade', () => {
  const t = ['AVNET INC']
  it('Sim quando o fornecedor está na lista (case/trim-insensível)', () => {
    expect(buscarCriticidade('avnet inc', t)).toBe('Sim')
  })
  it('Não quando o fornecedor não está na lista', () => {
    expect(buscarCriticidade('X', t)).toBe('Não')
  })
  it('null quando o fornecedor é vazio/ausente', () => {
    expect(buscarCriticidade(null, t)).toBeNull()
    expect(buscarCriticidade('   ', t)).toBeNull()
    expect(buscarCriticidade('', t)).toBeNull()
  })
})
describe('buscarNqa', () => {
  const t = [
    { quantidadeMin: 2, quantidadeMax: 8, tamanhoAmostra: 5 },
    { quantidadeMin: 500001, quantidadeMax: null, tamanhoAmostra: 1250 },
  ]
  it('acha na faixa fechada', () => { expect(buscarNqa(5, t)).toBe(5) })
  it('acha na faixa aberta (max null)', () => { expect(buscarNqa(999999, t)).toBe(1250) })
  it('null quando fora de qualquer faixa', () => { expect(buscarNqa(20, t)).toBeNull() })
  it('null quando a faixa não tem tamanho definido', () => {
    expect(buscarNqa(5, [{ quantidadeMin: 2, quantidadeMax: 8, tamanhoAmostra: null }])).toBeNull()
  })
})
describe('calcularCamposCalculados', () => {
  const campos: CampoCalc[] = [
    { campo: 'atraso', formula: 'diferenca_dias', formulaConfig: { a: 'data_chegada', b: 'data_prevista' } },
  ]
  const ctx = { fornecedoresCriticos: [], nqa: [], usuarioAtual: 'João', valoresAtuais: {} }
  it('calcula atraso', () => {
    const r = calcularCamposCalculados({ data_chegada: '2026-06-10', data_prevista: '2026-06-05' }, campos, ctx)
    expect(r.atraso).toBe(5)
  })
})
