import { describe, expect, it } from 'vitest'
import { horaDeEnviarResumo } from '../resumo'

/** Instante a partir da hora de PAREDE de São Paulo (UTC-3, sem horário de verão). */
function sp(dia: string, hhmm: string): Date { return new Date(`${dia}T${hhmm}:00-03:00`) }

describe('horaDeEnviarResumo', () => {
  it('antes da hora não manda', () => {
    expect(horaDeEnviarResumo('18:00', null, sp('2026-10-08', '17:59'))).toBe(false)
  })
  it('na hora em ponto manda', () => {
    expect(horaDeEnviarResumo('18:00', null, sp('2026-10-08', '18:00'))).toBe(true)
  })
  it('depois da hora, no mesmo dia, ainda manda se não mandou', () => {
    expect(horaDeEnviarResumo('18:00', null, sp('2026-10-08', '18:47'))).toBe(true)
  })
  it('já mandou HOJE: não manda de novo', () => {
    expect(horaDeEnviarResumo('18:00', '2026-10-08', sp('2026-10-08', '18:47'))).toBe(false)
  })
  it('mandou ONTEM: manda hoje', () => {
    expect(horaDeEnviarResumo('18:00', '2026-10-07', sp('2026-10-08', '18:01'))).toBe(true)
  })
  it('mandou ontem, mas ainda não chegou a hora de hoje', () => {
    expect(horaDeEnviarResumo('18:00', '2026-10-07', sp('2026-10-08', '09:00'))).toBe(false)
  })
  it('hora malformada nunca manda', () => {
    for (const ruim of ['', '18', '25:00', 'abc', '18:60']) {
      expect(horaDeEnviarResumo(ruim, null, sp('2026-10-08', '23:00')), ruim).toBe(false)
    }
  })
  it('23:30 em São Paulo é 02:30 do dia SEGUINTE em UTC — o dia é o da fábrica', () => {
    expect(horaDeEnviarResumo('23:00', '2026-10-08', sp('2026-10-08', '23:30'))).toBe(false)
  })
  it('00:30 em São Paulo ainda é o dia novo, e o de ontem não bloqueia', () => {
    expect(horaDeEnviarResumo('00:00', '2026-10-07', sp('2026-10-08', '00:30'))).toBe(true)
  })
  // Fronteiras extras (mutação): a hora em ponto também vale com o dia anterior guardado,
  // e o "agora" do processo em UTC cai no dia seguinte da fábrica.
  it('23:30 SP sem envio hoje manda (em UTC já é o dia seguinte)', () => {
    expect(horaDeEnviarResumo('23:00', '2026-10-07', sp('2026-10-08', '23:30'))).toBe(true)
  })
  it('hora em ponto com o dia anterior guardado manda', () => {
    expect(horaDeEnviarResumo('18:00', '2026-10-07', sp('2026-10-08', '18:00'))).toBe(true)
  })
  it('data inválida não manda', () => {
    expect(horaDeEnviarResumo('18:00', null, new Date(NaN))).toBe(false)
  })
})
