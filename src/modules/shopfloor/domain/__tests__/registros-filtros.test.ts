import { describe, it, expect } from 'vitest'
import { parsearFiltrosRegistros } from '../registros-filtros'

describe('parsearFiltrosRegistros', () => {
  it('passa cliente/posto/status/busca/de/ate (com trim)', () => {
    const f = parsearFiltrosRegistros({ cliente: ' Lince ', posto: 'Teste', status: 'aprovado', busca: ' 100 ', de: '2026-07-01', ate: '2026-07-28' })
    expect(f).toEqual({ cliente: 'Lince', posto: 'Teste', status: 'aprovado', busca: '100', de: '2026-07-01T00:00:00-03:00', ate: '2026-07-28T23:59:59.999-03:00' })
  })
  it('estende ate (só-data) pro fim do dia', () => {
    expect(parsearFiltrosRegistros({ ate: '2026-07-28' }).ate).toBe('2026-07-28T23:59:59.999-03:00')
  })
  it('ancora de (só-data) no início do dia em BRT', () => {
    expect(parsearFiltrosRegistros({ de: '2026-07-01' }).de).toBe('2026-07-01T00:00:00-03:00')
  })
  it('normaliza o SN pra numero_serie_norm', () => {
    const f = parsearFiltrosRegistros({ sn: '00-25.7891/001' })
    expect(f.snNorm).toBe('257891001'.replace(/^0+/, ''))
  })
  it('ignora vazios e brancos', () => {
    expect(parsearFiltrosRegistros({ cliente: '', posto: '   ', sn: '' })).toEqual({})
    expect(parsearFiltrosRegistros({})).toEqual({})
  })
  it('SN que normaliza pra vazio não entra', () => {
    expect(parsearFiltrosRegistros({ sn: '--' }).snNorm).toBeUndefined()
  })
})
