// src/modules/recebimento/domain/agrupamento-mes.test.ts
import { describe, it, expect } from 'vitest'
import { chaveMes, rotuloMes, inicioProximoMes, agruparPorMes } from './agrupamento-mes'

describe('chaveMes', () => {
  it('extrai YYYY-MM de uma data', () => {
    expect(chaveMes('2026-05-12')).toBe('2026-05')
  })
  it('retorna sem_data para nulo/vazio', () => {
    expect(chaveMes(null)).toBe('sem_data')
    expect(chaveMes(undefined)).toBe('sem_data')
    expect(chaveMes('')).toBe('sem_data')
  })
})

describe('rotuloMes', () => {
  it('formata mês/ano em pt-BR', () => {
    expect(rotuloMes('2026-07')).toBe('Julho/2026')
  })
  it('rotula sem_data como Aguardando chegada', () => {
    expect(rotuloMes('sem_data')).toBe('Aguardando chegada')
  })
})

describe('inicioProximoMes', () => {
  it('avança o mês', () => {
    expect(inicioProximoMes('2026-05')).toBe('2026-06-01')
  })
  it('vira o ano em dezembro', () => {
    expect(inicioProximoMes('2026-12')).toBe('2027-01-01')
  })
})

describe('agruparPorMes', () => {
  it('agrupa, conta e ordena (sem_data primeiro, meses desc)', () => {
    const grupos = agruparPorMes(['2026-05-01', '2026-05-20', null, '2026-06-03'])
    expect(grupos).toEqual([
      { chave: 'sem_data', rotulo: 'Aguardando chegada', total: 1 },
      { chave: '2026-06', rotulo: 'Junho/2026', total: 1 },
      { chave: '2026-05', rotulo: 'Maio/2026', total: 2 },
    ])
  })
  it('lista vazia → []', () => {
    expect(agruparPorMes([])).toEqual([])
  })
})
