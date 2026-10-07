import { describe, expect, it } from 'vitest'
import { ehJanelaTipo } from '../tipos'
import { resumoJanela, textoJanela } from '../janela'

describe('ehJanelaTipo', () => {
  it('conhece intervalos', () => {
    expect(ehJanelaTipo('intervalos')).toBe(true)
  })
  it('continua recusando o que não é janela', () => {
    expect(ehJanelaTipo('turno')).toBe(false)
    expect(ehJanelaTipo('')).toBe(false)
  })
})

describe('textoJanela com intervalos', () => {
  it('diz a faixa do bloco', () => {
    expect(textoJanela({
      tipo: 'intervalos', valor: 60,
      blocoInicio: '2026-10-06T10:00:00-03:00',
      blocoFim: '2026-10-06T11:00:00-03:00',
    })).toBe('das 10:00 às 11:00')
  })
  it('diz a faixa da sobra, que é mais curta', () => {
    expect(textoJanela({
      tipo: 'intervalos', valor: 180,
      blocoInicio: '2026-10-06T16:30:00-03:00',
      blocoFim: '2026-10-06T17:30:00-03:00',
    })).toBe('das 16:30 às 17:30')
  })
  it('sem a faixa, não inventa número', () => {
    expect(textoJanela({ tipo: 'intervalos', valor: 60 })).toBe('no bloco do turno')
  })
  it('faixa ilegível não derruba a mensagem', () => {
    expect(textoJanela({ tipo: 'intervalos', valor: 60, blocoInicio: 'lixo', blocoFim: 'lixo' })).toBe('no bloco do turno')
  })
})

describe('resumoJanela com intervalos', () => {
  it('mostra o passo na coluna da tabela', () => {
    expect(resumoJanela({ tipo: 'intervalos', valor: 60 })).toBe('Blocos de 1 h')
    expect(resumoJanela({ tipo: 'intervalos', valor: 90 })).toBe('Blocos de 1 h 30 min')
    expect(resumoJanela({ tipo: 'intervalos', valor: 30 })).toBe('Blocos de 30 min')
  })
})
