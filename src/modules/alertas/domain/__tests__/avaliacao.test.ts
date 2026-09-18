import { describe, it, expect } from 'vitest'
import { lerResultadoAvaliacao } from '../avaliacao'
import { ehRotaPublicaDeAlertas } from '../rotas'

describe('lerResultadoAvaliacao', () => {
  it('lê o resumo do alerta_avaliar (a fila já foi gravada no banco)', () => {
    const r = lerResultadoAvaliacao({
      ocupado: false,
      avaliadas: 3,
      enfileirados: 4,
      normalizadas: ['11111111-2222-3333-4444-555555555555'],
    })
    expect(r).toEqual({
      ocupado: false,
      avaliadas: 3,
      enfileirados: 4,
      normalizadas: ['11111111-2222-3333-4444-555555555555'],
    })
  })
  it('ocupado', () => {
    expect(lerResultadoAvaliacao({ ocupado: true, avaliadas: 0, enfileirados: 0, normalizadas: [] })).toEqual({
      ocupado: true,
      avaliadas: 0,
      enfileirados: 0,
      normalizadas: [],
    })
  })
  it('entrada inesperada não explode', () => {
    expect(lerResultadoAvaliacao(null)).toEqual({ ocupado: false, avaliadas: 0, enfileirados: 0, normalizadas: [] })
    expect(lerResultadoAvaliacao({ avaliadas: 'x', normalizadas: 'y' })).toEqual({
      ocupado: false,
      avaliadas: 0,
      enfileirados: 0,
      normalizadas: [],
    })
  })
  it('descarta id vazio em normalizadas', () => {
    expect(lerResultadoAvaliacao({ normalizadas: ['a', null, ''] }).normalizadas).toEqual(['a'])
  })
})

describe('ehRotaPublicaDeAlertas', () => {
  it('as rotas de alertas passam sem sessão', () => {
    expect(ehRotaPublicaDeAlertas('/api/alertas/avaliar')).toBe(true)
    expect(ehRotaPublicaDeAlertas('/api/alertas/telegram')).toBe(true)
    expect(ehRotaPublicaDeAlertas('/api/alertas/discord')).toBe(true)
  })
  it('o resto continua passando pela sessão', () => {
    expect(ehRotaPublicaDeAlertas('/shopfloor/operar')).toBe(false)
    expect(ehRotaPublicaDeAlertas('/api/anexos/x')).toBe(false)
    expect(ehRotaPublicaDeAlertas('/api/alertasfalso')).toBe(false)
  })
})
