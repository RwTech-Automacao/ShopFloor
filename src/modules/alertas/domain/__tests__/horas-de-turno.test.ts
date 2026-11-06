import { describe, expect, it } from 'vitest'
import { corteDeExpediente, ehDiaUtilSp, minutosDeExpediente } from '../horas-de-turno'

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

describe('corteDeExpediente', () => {
  const AGORA = sp('2026-10-28', '15:00') // quarta

  it('sem turno é agora menos o limite, em relógio corrido (fim de semana conta)', () => {
    expect(corteDeExpediente(AGORA, 168 * 60, []).getTime()).toBe(AGORA.getTime() - 168 * 3_600_000)
  })

  it('com turno, quem está no corte tem exatamente o limite; um minuto depois, menos', () => {
    const corte = corteDeExpediente(AGORA, 120, TURNOS) // 2 h de expediente
    expect(minutosDeExpediente(corte, AGORA, TURNOS)).toBeGreaterThanOrEqual(120)
    expect(minutosDeExpediente(new Date(corte.getTime() + 60_000), AGORA, TURNOS)).toBeLessThan(120)
    expect(corte.getTime()).toBe(sp('2026-10-28', '11:30').getTime()) // 13:30-15:00 (90) + 11:30-12:00 (30)
  })

  it('atravessa a noite e o fim de semana: o corte é o instante certo, não o relógio', () => {
    const segunda = sp('2026-11-02', '09:00')
    const corte = corteDeExpediente(segunda, 600, TURNOS) // 10 h de expediente
    expect(minutosDeExpediente(corte, segunda, TURNOS)).toBeGreaterThanOrEqual(600)
    expect(minutosDeExpediente(new Date(corte.getTime() + 60_000), segunda, TURNOS)).toBeLessThan(600)
    // sexta 30/10 ficou para trás do fim de semana: o corte cai na sexta, não no sábado
    expect(corte.getTime()).toBeLessThan(sp('2026-10-31', '00:00').getTime())
  })

  it('limite além do que o cálculo enxerga devolve o início da janela, sem travar', () => {
    const corte = corteDeExpediente(AGORA, 720 * 60 * 10, TURNOS)
    expect(Number.isFinite(corte.getTime())).toBe(true)
    expect(corte.getTime()).toBeLessThan(AGORA.getTime())
  })
})

describe('ehDiaUtilSp', () => {
  it('segunda a sexta, no calendário de São Paulo', () => {
    expect(ehDiaUtilSp(sp('2026-11-02', '08:00'))).toBe(true) // segunda
    expect(ehDiaUtilSp(sp('2026-11-06', '23:30'))).toBe(true) // sexta à noite (já é sábado em UTC)
    expect(ehDiaUtilSp(sp('2026-11-07', '00:10'))).toBe(false) // sábado, 03:10 UTC
    expect(ehDiaUtilSp(sp('2026-11-08', '12:00'))).toBe(false) // domingo
  })
})
