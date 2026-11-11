import { describe, it, expect } from 'vitest'
import {
  faixasDe,
  faixasDoBanco,
  serieNasFaixas,
  conferirSerieNasFaixas,
  faixasSobrepoem,
  faixasIguais,
  rotuloFaixas,
  lerFaixasDoFormulario,
} from '../faixas-sn'

// O caso real da OP 8682_F: 993 etiquetas certas + 7 com um dígito a mais.
const F1 = { sn_ini: '0845801001', sn_fim: '0845801993' }
const F2 = { sn_ini: '08458001024', sn_fim: '08458001030' }
const op8682 = { sn_ini: F1.sn_ini, sn_fim: F1.sn_fim, faixas: [F1, F2] }

describe('faixasDe', () => {
  it('usa a lista quando há faixas', () => {
    expect(faixasDe(op8682)).toEqual([F1, F2])
  })
  it('sem lista (ou lista vazia) cai na faixa da OP', () => {
    expect(faixasDe({ sn_ini: '1', sn_fim: '10' })).toEqual([{ sn_ini: '1', sn_fim: '10' }])
    expect(faixasDe({ sn_ini: '1', sn_fim: '10', faixas: [] })).toEqual([{ sn_ini: '1', sn_fim: '10' }])
  })
  it('OP sem faixa → nenhuma; faixa com um lado vazio é ignorada', () => {
    expect(faixasDe({ sn_ini: '', sn_fim: '' })).toEqual([])
    expect(faixasDe({ sn_ini: ' ', sn_fim: '10' })).toEqual([])
    expect(faixasDe({ sn_ini: '', sn_fim: '', faixas: [{ sn_ini: '', sn_fim: '' }] })).toEqual([])
  })
})

describe('faixasDoBanco', () => {
  it('ordena pelo seq e devolve só ini/fim', () => {
    expect(faixasDoBanco([{ seq: 2, ...F2 }, { seq: 1, ...F1 }])).toEqual([F1, F2])
  })
  it('nulo/indefinido → lista vazia', () => {
    expect(faixasDoBanco(null)).toEqual([])
    expect(faixasDoBanco(undefined)).toEqual([])
  })
})

describe('serieNasFaixas', () => {
  it('aceita SN de qualquer faixa e recusa o que não está em nenhuma', () => {
    expect(serieNasFaixas(op8682, '0845801500')).toBe(true)
    expect(serieNasFaixas(op8682, '08458001027')).toBe(true)
    expect(serieNasFaixas(op8682, '08458001031')).toBe(false)
    expect(serieNasFaixas(op8682, '0845801994')).toBe(false)
  })
  it('OP sem faixa → false', () => {
    expect(serieNasFaixas({ sn_ini: '', sn_fim: '' }, '1')).toBe(false)
  })
})

describe('conferirSerieNasFaixas (com o tamanho da faixa)', () => {
  it('dentro de uma faixa e no tamanho dela → ok', () => {
    expect(conferirSerieNasFaixas(op8682, '0845801001')).toEqual({ ok: true })
    expect(conferirSerieNasFaixas(op8682, '08458001030')).toEqual({ ok: true })
  })
  it('sem faixa nenhuma → sem_faixa', () => {
    expect(conferirSerieNasFaixas({ sn_ini: '', sn_fim: '' }, '1')).toEqual({ ok: false, motivo: 'sem_faixa' })
  })
  it('fora de todas → fora', () => {
    expect(conferirSerieNasFaixas(op8682, '777')).toEqual({ ok: false, motivo: 'fora' })
  })
  it('zeros emendados: cai numa faixa pelo número mas passa do tamanho DELA → longo', () => {
    // 845801500 está na faixa 1 (10 caracteres); com 11 caracteres é leitura suja, mesmo que a faixa 2 tenha 11.
    expect(conferirSerieNasFaixas(op8682, '00845801500')).toEqual({ ok: false, motivo: 'longo' })
  })
})

describe('faixasSobrepoem', () => {
  it('numéricas do mesmo formato: interseção dos números', () => {
    expect(faixasSobrepoem({ sn_ini: '1', sn_fim: '10' }, { sn_ini: '10', sn_fim: '20' })).toBe(true)
    expect(faixasSobrepoem({ sn_ini: '1', sn_fim: '10' }, { sn_ini: '11', sn_fim: '20' })).toBe(false)
  })
  it('largura diferente com os mesmos números sobrepõe (a faixa compara o número)', () => {
    expect(faixasSobrepoem({ sn_ini: '001', sn_fim: '100' }, { sn_ini: '0050', sn_fim: '0060' })).toBe(true)
  })
  it('o caso da 8682_F não sobrepõe', () => {
    expect(faixasSobrepoem(F1, F2)).toBe(false)
  })
  it('prefixos diferentes não sobrepõem', () => {
    expect(faixasSobrepoem({ sn_ini: 'A1', sn_fim: 'A10' }, { sn_ini: 'B1', sn_fim: 'B10' })).toBe(false)
  })
  it('lexicais: interseção das cadeias', () => {
    expect(faixasSobrepoem({ sn_ini: 'AB', sn_fim: 'AD' }, { sn_ini: 'AC', sn_fim: 'AZ' })).toBe(true)
    expect(faixasSobrepoem({ sn_ini: 'AB', sn_fim: 'AD' }, { sn_ini: 'AE', sn_fim: 'AZ' })).toBe(false)
  })
})

describe('faixasIguais', () => {
  it('compara na ordem, ignorando espaços nas pontas', () => {
    expect(faixasIguais([F1, F2], [{ sn_ini: ` ${F1.sn_ini}`, sn_fim: F1.sn_fim }, F2])).toBe(true)
    expect(faixasIguais([F1, F2], [F2, F1])).toBe(false)
    expect(faixasIguais([F1], [F1, F2])).toBe(false)
  })
})

describe('rotuloFaixas', () => {
  it('uma faixa: ini–fim; mais de uma: a primeira + N', () => {
    expect(rotuloFaixas({ sn_ini: '1', sn_fim: '10' })).toBe('1–10')
    expect(rotuloFaixas(op8682)).toBe('0845801001–0845801993 +1')
    expect(rotuloFaixas({ sn_ini: '', sn_fim: '' })).toBe('—')
  })
})

describe('lerFaixasDoFormulario', () => {
  it('lê o JSON do campo faixas, aparando', () => {
    expect(lerFaixasDoFormulario(JSON.stringify([{ sn_ini: ' 1 ', sn_fim: '10' }, { sn_ini: '20', sn_fim: '30' }]), '', '')).toEqual([
      { sn_ini: '1', sn_fim: '10' },
      { sn_ini: '20', sn_fim: '30' },
    ])
  })
  it('sem o campo faixas: a faixa única de sn_ini/sn_fim', () => {
    expect(lerFaixasDoFormulario(null, ' SN0001', 'SN0010 ')).toEqual([{ sn_ini: 'SN0001', sn_fim: 'SN0010' }])
  })
  it('JSON inválido ou fora do formato → lista vazia (a validação recusa)', () => {
    expect(lerFaixasDoFormulario('{', '1', '2')).toEqual([])
    expect(lerFaixasDoFormulario('{"a":1}', '1', '2')).toEqual([])
    expect(lerFaixasDoFormulario('[1,null]', '1', '2')).toEqual([
      { sn_ini: '', sn_fim: '' },
      { sn_ini: '', sn_fim: '' },
    ])
  })
})
