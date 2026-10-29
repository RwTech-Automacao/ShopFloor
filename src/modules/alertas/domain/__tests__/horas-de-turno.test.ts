import { describe, expect, it } from 'vitest'
import { minutosDeExpediente } from '../horas-de-turno'

/** Instante a partir da hora de PAREDE de São Paulo (UTC-3, sem horário de verão). */
const sp = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`)

const TURNOS = [
  { inicio: '07:00', fim: '12:00' },
  { inicio: '13:30', fim: '17:30' },
]

describe('minutosDeExpediente', () => {
  it('dentro de um turno conta o tempo corrido', () => {
    expect(minutosDeExpediente(sp('2026-10-28', '08:00'), sp('2026-10-28', '10:30'), TURNOS)).toBe(150)
  })

  it('o almoço não conta', () => {
    // 11:00-12:00 (60) + 13:30-14:30 (60)
    expect(minutosDeExpediente(sp('2026-10-28', '11:00'), sp('2026-10-28', '14:30'), TURNOS)).toBe(120)
  })

  it('pronto depois do fim do turno só começa a contar no turno seguinte', () => {
    // quarta 17:50 -> quinta 09:20: nada na quarta, quinta 07:00-09:20 = 140
    expect(minutosDeExpediente(sp('2026-10-28', '17:50'), sp('2026-10-29', '09:20'), TURNOS)).toBe(140)
  })

  it('sábado e domingo não contam', () => {
    // sexta 16:30-17:30 (60) + segunda 07:00-08:00 (60)
    expect(minutosDeExpediente(sp('2026-10-30', '16:30'), sp('2026-11-02', '08:00'), TURNOS)).toBe(120)
  })

  it('sem turno cadastrado conta relógio corrido, inclusive fim de semana', () => {
    expect(minutosDeExpediente(sp('2026-10-30', '16:00'), sp('2026-10-30', '19:00'), [])).toBe(180)
    expect(minutosDeExpediente(sp('2026-10-31', '10:00'), sp('2026-10-31', '12:00'), [])).toBe(120)
  })

  it('fronteira exata: início do turno conta, fim não passa', () => {
    expect(minutosDeExpediente(sp('2026-10-28', '07:00'), sp('2026-10-28', '07:01'), TURNOS)).toBe(1)
    expect(minutosDeExpediente(sp('2026-10-28', '17:30'), sp('2026-10-28', '18:30'), TURNOS)).toBe(0)
  })

  it('fim antes ou igual ao início devolve 0', () => {
    expect(minutosDeExpediente(sp('2026-10-28', '10:00'), sp('2026-10-28', '10:00'), TURNOS)).toBe(0)
    expect(minutosDeExpediente(sp('2026-10-28', '11:00'), sp('2026-10-28', '10:00'), TURNOS)).toBe(0)
  })

  it('ignora turno ilegível em vez de inventar horário', () => {
    const sujo = [{ inicio: '25:00', fim: '26:00' }, ...TURNOS]
    expect(minutosDeExpediente(sp('2026-10-28', '08:00'), sp('2026-10-28', '09:00'), sujo)).toBe(60)
  })

  it('limita o período muito antigo sem travar (item parado há meses)', () => {
    const r = minutosDeExpediente(sp('2025-01-01', '08:00'), sp('2026-10-28', '08:00'), TURNOS)
    expect(Number.isFinite(r)).toBe(true)
    expect(r).toBeGreaterThan(0)
  })
})
