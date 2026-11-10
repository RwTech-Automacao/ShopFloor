import { describe, it, expect } from 'vitest'
import { LEMBRETE_DIA_MIN, LEMBRETE_SEMANA_MIN, minutosDoModoLembrete, modoLembreteInicial } from '../lembrete'

describe('frequência do lembrete', () => {
  it('1 vez por dia = 1440 min; 1 vez por semana = 10080 min', () => {
    expect(LEMBRETE_DIA_MIN).toBe(1440)
    expect(LEMBRETE_SEMANA_MIN).toBe(10080)
  })

  it('o valor salvo abre na opção que bate com ele', () => {
    expect(modoLembreteInicial('')).toBe('nenhum')
    expect(modoLembreteInicial('1440')).toBe('dia')
    expect(modoLembreteInicial('10080')).toBe('semana')
    expect(modoLembreteInicial('60')).toBe('personalizado')
    expect(modoLembreteInicial('3600')).toBe('personalizado')
  })

  it('cada opção fixa os minutos; o personalizado mantém o que estava no campo', () => {
    expect(minutosDoModoLembrete('nenhum', '60')).toBe('')
    expect(minutosDoModoLembrete('dia', '60')).toBe('1440')
    expect(minutosDoModoLembrete('semana', '')).toBe('10080')
    expect(minutosDoModoLembrete('personalizado', '1440')).toBe('1440')
    expect(minutosDoModoLembrete('personalizado', '')).toBe('')
  })
})
