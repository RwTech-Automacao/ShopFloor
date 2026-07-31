import { describe, it, expect } from 'vitest'
import {
  agruparTempoBurninPorPosto,
  temposParaLinhas,
  parseTempoBurninPorPosto,
} from '../burnin-posto'

describe('agruparTempoBurninPorPosto', () => {
  it('linhas do banco → mapa posto→minutos', () => {
    expect(agruparTempoBurninPorPosto([
      { posto: 'Burn-in', tempo_min: 360 },
      { posto: 'Burn-in 2', tempo_min: 90 },
    ])).toEqual({ 'Burn-in': 360, 'Burn-in 2': 90 })
  })
  it('lista vazia → objeto vazio', () => {
    expect(agruparTempoBurninPorPosto([])).toEqual({})
  })
})

describe('temposParaLinhas', () => {
  it('mapa → linhas {posto,tempo_min}', () => {
    expect(temposParaLinhas({ 'Burn-in': 360, 'Burn-in 2': 90 })).toEqual([
      { posto: 'Burn-in', tempo_min: 360 },
      { posto: 'Burn-in 2', tempo_min: 90 },
    ])
  })
})

describe('parseTempoBurninPorPosto', () => {
  it('dois postos com tempos diferentes → mapa em minutos', () => {
    const json = JSON.stringify({ 'Burn-in': '6:00', 'Burn-in 2': '1:30' })
    expect(parseTempoBurninPorPosto(json, ['Burn-in', 'Burn-in 2'])).toEqual({
      ok: true,
      tempos: { 'Burn-in': 360, 'Burn-in 2': 90 },
    })
  })
  it('campo vazio e 0:00 são ignorados (sem mínimo)', () => {
    const json = JSON.stringify({ 'Burn-in': '', 'Burn-in 2': '0:00' })
    expect(parseTempoBurninPorPosto(json, ['Burn-in', 'Burn-in 2'])).toEqual({ ok: true, tempos: {} })
  })
  it('mantém só postos de burnin do fluxo', () => {
    const json = JSON.stringify({ 'Burn-in': '2:00', 'Teste': '3:00' })
    expect(parseTempoBurninPorPosto(json, ['Burn-in'])).toEqual({ ok: true, tempos: { 'Burn-in': 120 } })
  })
  it('tempo inválido → { ok:false, posto }', () => {
    const json = JSON.stringify({ 'Burn-in': 'abc' })
    expect(parseTempoBurninPorPosto(json, ['Burn-in'])).toEqual({ ok: false, posto: 'Burn-in' })
  })
  it('JSON inválido ou array → mapa vazio', () => {
    expect(parseTempoBurninPorPosto('nope', ['Burn-in'])).toEqual({ ok: true, tempos: {} })
    expect(parseTempoBurninPorPosto('[]', ['Burn-in'])).toEqual({ ok: true, tempos: {} })
  })
})
