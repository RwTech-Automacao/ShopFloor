import { describe, it, expect } from 'vitest'
import {
  normalizarCodigo, formatarPedido, resolverDoc, padSeq, formatarVolume,
  gerarEtiquetasDoProcesso, gerarCsv,
} from '../partnumber'

describe('formatarPedido', () => {
  it('0529/26 -> 052926', () => { expect(formatarPedido('0529/26')).toBe('052926') })
  it('1234/25 -> 123425', () => { expect(formatarPedido('1234/25')).toBe('123425') })
  it('vazio -> vazio', () => { expect(formatarPedido('')).toBe('') })
})
describe('resolverDoc', () => {
  it('usa DI/INPI (só dígitos) quando presente', () => {
    expect(resolverDoc('26BR0000902016-1', '999')).toBe('2600009020161')
  })
  it('cai para a NF quando DI/INPI vazio', () => {
    expect(resolverDoc('', '12345')).toBe('12345')
  })
})
describe('padSeq / formatarVolume', () => {
  it('2 dígitos por padrão, 3 se total >= 100', () => {
    expect(padSeq(1, 13)).toBe('01')
    expect(padSeq(1, 120)).toBe('001')
  })
  it('formatarVolume 1 de 13 -> 01-13', () => { expect(formatarVolume(1, 13)).toBe('01-13') })
})
describe('normalizarCodigo', () => {
  it('remove hífens finais', () => { expect(normalizarCodigo('RWCN98-')).toBe('RWCN98') })
})

describe('gerarEtiquetasDoProcesso (exemplo validado RWCN98)', () => {
  const p = {
    id: 'x', codigoMaterial: 'RWCN98', numeroPedido: '0529/26',
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

describe('gerarCsv', () => {
  it('aspas, CRLF, sem cabeçalho', () => {
    const csv = gerarCsv([{ partNumber: 'A', codigo: 'B', volume: '01-01' }])
    expect(csv).toBe('"A","B","01-01"')
  })
})
