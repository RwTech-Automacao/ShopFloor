import { describe, expect, it } from 'vitest'
import {
  ESTADO_GRID_PADRAO,
  codificarEstadoGrid,
  decodificarEstadoGrid,
  faixaDoMes,
  type EstadoGrid,
} from '../estado-grid'

const COLUNAS = ['numero', 'fornecedor', 'data_chegada', 'status']

describe('codificar/decodificarEstadoGrid', () => {
  it('faz ida e volta preservando o estado', () => {
    const estado: EstadoGrid = {
      ordenar: 'fornecedor',
      direcao: 'asc',
      pagina: 3,
      tamanho: 100,
      filtros: { fornecedor: { texto: 'ACME' }, status: { valores: ['Aprovado'] } },
    }
    expect(decodificarEstadoGrid(codificarEstadoGrid(estado), COLUNAS)).toEqual(estado)
  })

  it('param ausente → padrão', () => {
    expect(decodificarEstadoGrid(undefined, COLUNAS)).toEqual(ESTADO_GRID_PADRAO)
  })

  it('param inválido (não é JSON) → padrão, sem quebrar', () => {
    expect(decodificarEstadoGrid('%%%nao-e-json%%%', COLUNAS)).toEqual(ESTADO_GRID_PADRAO)
  })

  it('coluna de ordenação fora da whitelist → volta ao padrão', () => {
    const param = codificarEstadoGrid({ ...ESTADO_GRID_PADRAO, ordenar: 'coluna_maliciosa' })
    expect(decodificarEstadoGrid(param, COLUNAS).ordenar).toBe(ESTADO_GRID_PADRAO.ordenar)
  })

  it('filtro em coluna fora da whitelist é descartado', () => {
    const param = codificarEstadoGrid({
      ...ESTADO_GRID_PADRAO,
      filtros: { fornecedor: { texto: 'ok' }, coluna_maliciosa: { texto: 'x' } },
    })
    expect(decodificarEstadoGrid(param, COLUNAS).filtros).toEqual({ fornecedor: { texto: 'ok' } })
  })

  it('página negativa → 0 e direção inválida → desc', () => {
    const param = encodeURIComponent(JSON.stringify({ ordenar: 'numero', direcao: 'xxx', pagina: -5, tamanho: 50, filtros: {} }))
    const e = decodificarEstadoGrid(param, COLUNAS)
    expect(e.pagina).toBe(0)
    expect(e.direcao).toBe('desc')
  })

  it('tamanho fora dos permitidos → padrão (50)', () => {
    const param = codificarEstadoGrid({ ...ESTADO_GRID_PADRAO, tamanho: 999 })
    expect(decodificarEstadoGrid(param, COLUNAS).tamanho).toBe(50)
  })

  it('filtro vazio é descartado (não vira filtro que não filtra nada)', () => {
    const param = codificarEstadoGrid({
      ...ESTADO_GRID_PADRAO,
      filtros: { fornecedor: { texto: '   ' }, status: { valores: [] } },
    })
    expect(decodificarEstadoGrid(param, COLUNAS).filtros).toEqual({})
  })
})

describe('faixaDoMes', () => {
  it('mês vira a faixa [primeiro dia, primeiro dia do mês seguinte)', () => {
    expect(faixaDoMes('2026-07')).toEqual({ inicio: '2026-07-01', fim: '2026-08-01' })
  })
  it('dezembro vira janeiro do ano seguinte', () => {
    expect(faixaDoMes('2026-12')).toEqual({ inicio: '2026-12-01', fim: '2027-01-01' })
  })
  it('sem_data não tem faixa (é filtro de nulo)', () => {
    expect(faixaDoMes('sem_data')).toBeNull()
  })
  it('valor inválido não tem faixa', () => {
    expect(faixaDoMes('abacaxi')).toBeNull()
  })
})
