import { describe, expect, it } from 'vitest'
import { diaSp, resumoDaRodada } from '../resumo'

/**
 * O pacote do `p_resumos` (dia + faixas em instantes). Afirma o VALOR, não só a forma. Roda nos
 * quatro fusos (padrão, UTC, Pacific/Kiritimati UTC+14, Pacific/Midway UTC-11): o resultado tem
 * de ser o mesmo em todos, porque a fábrica é São Paulo e o servidor de produção roda em UTC.
 */
const TURNO = [
  { inicio: '07:00', fim: '12:00' },
  { inicio: '13:00', fim: '17:00' },
]

describe('diaSp', () => {
  it('é o dia de São Paulo, não o do processo', () => {
    // 01:30 UTC de 09/10 = 22:30 de 08/10 em São Paulo
    expect(diaSp(new Date('2026-10-09T01:30:00Z'))).toBe('2026-10-08')
    // 02:59 UTC = 23:59 SP; 03:00 UTC = 00:00 SP do dia seguinte
    expect(diaSp(new Date('2026-10-09T02:59:00Z'))).toBe('2026-10-08')
    expect(diaSp(new Date('2026-10-09T03:00:00Z'))).toBe('2026-10-09')
  })
})

describe('resumoDaRodada', () => {
  it('às 18:00 SP: dia 08 e cada faixa como instante UTC (SP é UTC-3)', () => {
    const r = resumoDaRodada(TURNO, new Date('2026-10-08T21:00:00Z')) // 18:00 SP
    expect(r).toEqual({
      dia: '2026-10-08',
      faixas: [
        { inicio: '2026-10-08T10:00:00.000Z', fim: '2026-10-08T15:00:00.000Z' },
        { inicio: '2026-10-08T16:00:00.000Z', fim: '2026-10-08T20:00:00.000Z' },
      ],
    })
  })

  it('o dia e as faixas são o dia de SP mesmo quando o UTC já virou o dia (22:30 SP = 01:30 UTC)', () => {
    const r = resumoDaRodada(TURNO, new Date('2026-10-09T01:30:00Z'))
    expect(r?.dia).toBe('2026-10-08')
    expect(r?.faixas[0]).toEqual({ inicio: '2026-10-08T10:00:00.000Z', fim: '2026-10-08T15:00:00.000Z' })
  })

  it('intervalo ilegível ou invertido é pulado; sem nenhum legível devolve null', () => {
    const agora = new Date('2026-10-08T21:00:00Z')
    expect(resumoDaRodada([{ inicio: '12:00', fim: '07:00' }, { inicio: 'x', fim: '10:00' }], agora)).toBeNull()
    expect(resumoDaRodada([{ inicio: '12:00', fim: '07:00' }, TURNO[0]!], agora)?.faixas).toHaveLength(1)
    expect(resumoDaRodada([], agora)).toBeNull()
  })

  it('data inválida devolve null (não estoura dentro do Intl)', () => {
    expect(resumoDaRodada(TURNO, new Date('lixo'))).toBeNull()
  })
})
