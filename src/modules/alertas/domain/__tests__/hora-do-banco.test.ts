import { describe, it, expect } from 'vitest'
import { lerHoraDoBanco } from '../intervalos'

/**
 * Visto em produção em 09/10/2026, no dia em que o resumo diário subiu: a regra estava ativa, no
 * horário, com responsável e canal — e nada saiu. `alerta_regras.resumo_enviado_em` ficou nulo.
 *
 * Causa: coluna `time` do Postgres chega 'HH:MM:SS' pelo PostgREST, e `lerHhMm` é ancorado em
 * 'HH:MM'. O lado da TELA cortava os segundos; o lado do CRON não. Duas cópias da mesma conversão,
 * e só uma estava certa — exatamente o que o comentário de `lerIntervaloDoBanco` avisa que
 * aconteceria.
 *
 * Esta função é a conversão única para UMA hora vinda do banco. Os dois lados usam ela.
 */
describe('lerHoraDoBanco', () => {
  it('aceita o que o PostgREST entrega de uma coluna time', () => {
    expect(lerHoraDoBanco('12:45:00')).toBe('12:45')
    expect(lerHoraDoBanco('07:00:00')).toBe('07:00')
    expect(lerHoraDoBanco('23:59:00')).toBe('23:59')
  })

  it('aceita fração de segundo (o Postgres manda quando a coluna tem precisão)', () => {
    expect(lerHoraDoBanco('12:45:00.000')).toBe('12:45')
  })

  it('aceita a forma curta, que é como a tela e os testes falam', () => {
    expect(lerHoraDoBanco('12:45')).toBe('12:45')
  })

  it('o que não é hora vira null, para quem lê pular em vez de inventar horário', () => {
    expect(lerHoraDoBanco('')).toBeNull()
    expect(lerHoraDoBanco('25:00:00')).toBeNull()
    expect(lerHoraDoBanco('12:60')).toBeNull()
    expect(lerHoraDoBanco('meio-dia')).toBeNull()
    expect(lerHoraDoBanco(null)).toBeNull()
    expect(lerHoraDoBanco(undefined)).toBeNull()
    expect(lerHoraDoBanco(1245)).toBeNull()
  })
})
