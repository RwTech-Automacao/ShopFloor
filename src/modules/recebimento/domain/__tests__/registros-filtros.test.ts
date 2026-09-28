import { describe, it, expect } from 'vitest'
import { parsearFiltrosRegistros } from '../registros-filtros'

describe('parsearFiltrosRegistros', () => {
  it('ignora vazio e só espaço', () => {
    expect(parsearFiltrosRegistros({})).toEqual({})
    expect(parsearFiltrosRegistros({ emb: '  ', item: '', colaborador: undefined })).toEqual({})
  })

  it('apara os textos', () => {
    expect(parsearFiltrosRegistros({ emb: ' EMB390 ', item: ' CAPJ91 ', colaborador: ' Ana ' }))
      .toEqual({ emb: 'EMB390', item: 'CAPJ91', colaborador: 'Ana' })
  })

  it('só aceita etapa que existe no fluxo', () => {
    expect(parsearFiltrosRegistros({ etapa: 'qualidade' }).etapa).toBe('qualidade')
    expect(parsearFiltrosRegistros({ etapa: 'reprovado' }).etapa).toBe('reprovado')
    expect(parsearFiltrosRegistros({ etapa: 'manutencao' }).etapa).toBeUndefined()
  })

  it('ancora a data só-data no fuso de Brasília (a janela não desliza 3h)', () => {
    expect(parsearFiltrosRegistros({ de: '2026-09-24', ate: '2026-09-24' })).toEqual({
      de: '2026-09-24T00:00:00-03:00',
      ate: '2026-09-24T23:59:59.999-03:00',
    })
  })

  it('data com hora passa direto', () => {
    expect(parsearFiltrosRegistros({ de: '2026-09-24T08:00:00-03:00' }).de)
      .toBe('2026-09-24T08:00:00-03:00')
  })
})
