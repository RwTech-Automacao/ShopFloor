import { describe, it, expect } from 'vitest'
import { parsearFiltrosRegistros } from '../registros-filtros'

describe('parsearFiltrosRegistros', () => {
  it('passa cliente/posto/status/busca/de/ate (com trim)', () => {
    const f = parsearFiltrosRegistros({ cliente: ' Lince ', posto: 'Teste', status: 'aprovado', busca: ' 100 ', de: '2026-07-01', ate: '2026-07-28' })
    expect(f).toEqual({ cliente: 'Lince', posto: 'Teste', status: 'aprovado', busca: '100', de: '2026-07-01', ate: '2026-07-28' })
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
