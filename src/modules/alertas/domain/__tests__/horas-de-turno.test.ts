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

  it('sexta à noite até segunda cedo: só o fim da sexta e o começo da segunda', () => {
    const noturno = [{ inicio: '07:00', fim: '12:00' }, { inicio: '18:00', fim: '23:00' }]
    // sexta 22:00-23:00 (60) + sábado/domingo (0) + segunda 07:00-08:00 (60)
    expect(minutosDeExpediente(sp('2026-10-30', '22:00'), sp('2026-11-02', '08:00'), noturno)).toBe(120)
  })

  it('janela que atravessa a virada do ano (quinta 31/12 -> sexta 01/01)', () => {
    // quinta 16:00-17:30 (90) + sexta 07:00-08:00 (60)
    expect(minutosDeExpediente(sp('2026-12-31', '16:00'), sp('2027-01-01', '08:00'), TURNOS)).toBe(150)
  })

  it('turno da noite: 23:00 de São Paulo já é o dia seguinte em UTC e conta no dia certo', () => {
    const tarde = [{ inicio: '18:00', fim: '23:59' }]
    // quarta 23:00-23:59 SP (02:00Z de quinta): 59 min, na quarta
    expect(minutosDeExpediente(sp('2026-10-28', '23:00'), sp('2026-10-28', '23:59'), tarde)).toBe(59)
  })

  it('limita o período a 400 dias: 1000 dias atrás dá o mesmo que 400 dias atrás', () => {
    const t1 = sp('2026-10-28', '08:00')
    const dia = 24 * 60 * 60_000
    const longe = minutosDeExpediente(new Date(t1.getTime() - 1000 * dia), t1, TURNOS)
    const limite = minutosDeExpediente(new Date(t1.getTime() - 400 * dia), t1, TURNOS)
    expect(longe).toBe(limite)
    expect(longe).toBeGreaterThan(0)
  })

  it('custa pouco: roda no processo que atende o bipe, então 400 dias não pode travar o laço de eventos', () => {
    const t1 = sp('2026-10-28', '08:00')
    const t0 = new Date(t1.getTime() - 400 * 24 * 60 * 60_000)
    const ini = performance.now()
    for (let i = 0; i < 50; i++) minutosDeExpediente(t0, t1, TURNOS)
    // 50 chamadas < 1500 ms = 30 ms cada, folga larga sobre o esperado (poucos ms) para não
    // ficar instável em máquina lenta; antes do cache dos formatadores eram ~270 ms por chamada.
    expect(performance.now() - ini).toBeLessThan(1500)
  })
})
