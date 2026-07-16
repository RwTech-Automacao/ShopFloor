// src/modules/recebimento/domain/agrupamento-mes.test.ts
import { describe, it, expect } from 'vitest'
import { rotuloMes, inicioProximoMes } from './agrupamento-mes'

describe('rotuloMes', () => {
  it('formata mês/ano em pt-BR', () => {
    expect(rotuloMes('2026-07')).toBe('Julho/2026')
  })
  it('rotula sem_data como Aguardando data de chegada', () => {
    expect(rotuloMes('sem_data')).toBe('Aguardando data de chegada')
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
