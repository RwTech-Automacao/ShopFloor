import { describe, it, expect } from 'vitest'
import {
  normalizarCodigo, formatarPedido, resolverDoc, padSeq, formatarVolume,
  gerarEtiquetasDoProcesso, gerarCsv,
  camposCompletosEtiqueta, elegivelParaEtiqueta,
} from '../partnumber'

describe('formatarPedido', () => {
  it('0529/26 -> 052926', () => { expect(formatarPedido('0529/26')).toBe('052926') })
  it('1234/25 -> 123425', () => { expect(formatarPedido('1234/25')).toBe('123425') })
  it('vazio -> vazio', () => { expect(formatarPedido('')).toBe('') })
})
describe('resolverDoc', () => {
  it('usa DI/DUINPI (só dígitos) quando presente', () => {
    expect(resolverDoc('26BR0000902016-1', '999')).toBe('2600009020161')
  })
  it('cai para a NF quando DI/DUINPI vazio', () => {
    expect(resolverDoc('', '12345')).toBe('12345')
  })
})
describe('padSeq / formatarVolume', () => {
  it('2 dígitos por padrão, 3 se total >= 100 (limite exato)', () => {
    expect(padSeq(1, 13)).toBe('01')
    expect(padSeq(1, 99)).toBe('01')
    expect(padSeq(1, 100)).toBe('001')
    expect(padSeq(1, 120)).toBe('001')
  })
  it('formatarVolume 1 de 13 -> 01-13', () => { expect(formatarVolume(1, 13)).toBe('01-13') })
})
describe('normalizarCodigo', () => {
  it('remove hífens finais', () => { expect(normalizarCodigo('RWCN98-')).toBe('RWCN98') })
})

describe('gerarEtiquetasDoProcesso (exemplo validado RWCN98)', () => {
  const p = {
    id: 'x', status: 'Aprovado', codigoMaterial: 'RWCN98', numeroPedido: '0529/26',
    diInpi: '26BR0000902016-1', numeroNf: null, volumes: 13,
  }
  const r = gerarEtiquetasDoProcesso(p)
  it('não é incompleto e gera 13 etiquetas', () => {
    expect(r.incompleto).toBe(false)
    expect(r.etiquetas).toHaveLength(13)
  })
  it('primeiro e último Part Number exatos', () => {
    expect(r.etiquetas[0]).toEqual({ partNumber: 'RWCN98-052926260000902016101', codigo: 'RWCN98', volume: '01-13' })
    expect(r.etiquetas[12]).toEqual({ partNumber: 'RWCN98-052926260000902016113', codigo: 'RWCN98', volume: '13-13' })
  })
  it('marca incompleto quando falta pedido', () => {
    expect(gerarEtiquetasDoProcesso({ ...p, numeroPedido: null }).incompleto).toBe(true)
  })
})

describe('camposCompletosEtiqueta', () => {
  const base = {
    id: 'x',
    status: 'Aprovado',
    codigoMaterial: 'RWCN98',
    numeroPedido: '5292/26',
    diInpi: '260000902016',
    numeroNf: null,
    volumes: 13,
  }
  it('completo quando tem código, pedido, doc e volumes >= 1', () => {
    expect(camposCompletosEtiqueta(base)).toBe(true)
  })
  it('incompleto sem código / sem pedido / sem doc', () => {
    expect(camposCompletosEtiqueta({ ...base, codigoMaterial: null })).toBe(false)
    expect(camposCompletosEtiqueta({ ...base, numeroPedido: '' })).toBe(false)
    expect(camposCompletosEtiqueta({ ...base, diInpi: null, numeroNf: null })).toBe(false)
  })
  it('incompleto quando volumes < 1 / nulo', () => {
    expect(camposCompletosEtiqueta({ ...base, volumes: 0 })).toBe(false)
    expect(camposCompletosEtiqueta({ ...base, volumes: null })).toBe(false)
  })
  it('doc aceita NF quando DI/DUINPI vazio', () => {
    expect(camposCompletosEtiqueta({ ...base, diInpi: null, numeroNf: '0665/26' })).toBe(true)
  })
})

describe('elegivelParaEtiqueta', () => {
  const base = {
    id: 'x',
    status: 'Aprovado',
    codigoMaterial: 'RWCN98',
    numeroPedido: '5292/26',
    diInpi: '260000902016',
    numeroNf: null,
    volumes: 13,
  }
  it('não terminal → aguardando', () => {
    expect(elegivelParaEtiqueta({ ...base, status: 'aberto' })).toEqual({ elegivel: false, motivo: 'aguardando' })
    expect(elegivelParaEtiqueta({ ...base, status: 'em_conferencia' })).toEqual({ elegivel: false, motivo: 'aguardando' })
  })
  it('terminal mas incompleto → incompleto', () => {
    expect(elegivelParaEtiqueta({ ...base, status: 'Reprovado', volumes: 0 })).toEqual({ elegivel: false, motivo: 'incompleto' })
  })
  it('terminal + completo → elegível (inclui status terminal custom)', () => {
    expect(elegivelParaEtiqueta(base)).toEqual({ elegivel: true, motivo: null })
    expect(elegivelParaEtiqueta({ ...base, status: 'Aprovado condicional' })).toEqual({ elegivel: true, motivo: null })
  })
})

describe('gerarCsv', () => {
  it('uma linha: aspas, sem cabeçalho', () => {
    const csv = gerarCsv([{ partNumber: 'A', codigo: 'B', volume: '01-01' }])
    expect(csv).toBe('"A","B","01-01"')
  })
  it('várias linhas juntadas por CRLF e escape de aspas', () => {
    const csv = gerarCsv([
      { partNumber: 'A"B', codigo: 'C', volume: '01-02' },
      { partNumber: 'X', codigo: 'Y', volume: '02-02' },
    ])
    expect(csv).toBe('"A""B","C","01-02"\r\n"X","Y","02-02"')
  })
})
