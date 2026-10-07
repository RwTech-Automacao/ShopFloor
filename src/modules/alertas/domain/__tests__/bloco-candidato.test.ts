import { describe, expect, it } from 'vitest'
import { blocoCandidato, sobraDoIntervalo, type Intervalo } from '../intervalos'

/** Um instante a partir da hora de PAREDE de São Paulo (que é UTC-3, sem horário de verão). */
function sp(dia: string, hhmm: string): Date {
  return new Date(`${dia}T${hhmm}:00-03:00`)
}
/** 'AAAA-MM-DD HH:MM' do bloco, em São Paulo, para o teste não depender do fuso do processo. */
function emSp(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}
function faixa(b: { inicio: Date; fim: Date } | null): string | null {
  return b === null ? null : `${emSp(b.inicio)} → ${emSp(b.fim)}`
}

const MANHA: Intervalo = { inicio: '07:00', fim: '12:00' }
const TARDE: Intervalo = { inicio: '13:30', fim: '17:30' }
const MEIA_NOITE: Intervalo = { inicio: '00:00', fim: '03:00' }
const DOIS = [MANHA, TARDE]

describe('blocoCandidato', () => {
  it('às 09:30 o último fechado é 08:00–09:00', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '09:30')))).toBe(
      '2026-10-06 08:00 → 2026-10-06 09:00',
    )
  })

  it('às 07:30 nenhum bloco fechou ainda', () => {
    expect(blocoCandidato(DOIS, 60, sp('2026-10-06', '07:30'))).toBeNull()
  })

  it('às 08:00 em ponto o bloco das 07:00–08:00 JÁ fechou', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '08:00')))).toBe(
      '2026-10-06 07:00 → 2026-10-06 08:00',
    )
  })

  it('no almoço, o último fechado é o fim da manhã', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '13:00')))).toBe(
      '2026-10-06 11:00 → 2026-10-06 12:00',
    )
  })

  it('à tarde ladrilha do 13:30, não do relógio cheio', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '14:40')))).toBe(
      '2026-10-06 13:30 → 2026-10-06 14:30',
    )
  })

  it('depois do turno, o último fechado é o último do dia', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '18:20')))).toBe(
      '2026-10-06 16:30 → 2026-10-06 17:30',
    )
  })

  it('às 06:10 de segunda NÃO devolve o bloco de sexta', () => {
    // 2026-10-05 é segunda-feira
    expect(blocoCandidato(DOIS, 60, sp('2026-10-05', '06:10'))).toBeNull()
  })

  it('a sobra é medida com a faixa real', () => {
    // 13:30–17:30 com passo de 3 h: bloco cheio 13:30–16:30 e sobra 16:30–17:30
    expect(faixa(blocoCandidato([TARDE], 180, sp('2026-10-06', '17:35')))).toBe(
      '2026-10-06 16:30 → 2026-10-06 17:30',
    )
    // às 17:00 a sobra ainda não fechou; o último fechado é o bloco cheio
    expect(faixa(blocoCandidato([TARDE], 180, sp('2026-10-06', '17:00')))).toBe(
      '2026-10-06 13:30 → 2026-10-06 16:30',
    )
  })

  it('passo igual ao intervalo dá um bloco só', () => {
    expect(faixa(blocoCandidato([TARDE], 240, sp('2026-10-06', '17:35')))).toBe(
      '2026-10-06 13:30 → 2026-10-06 17:30',
    )
  })

  it('sem intervalo nenhum devolve null', () => {
    expect(blocoCandidato([], 60, sp('2026-10-06', '09:30'))).toBeNull()
  })

  it('atravessa a meia-noite em UTC sem errar o dia da fábrica', () => {
    // 21:30 em São Paulo é 00:30 do dia seguinte em UTC. O bloco tem que ser do dia 06, não do 07.
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '21:30')))).toBe(
      '2026-10-06 16:30 → 2026-10-06 17:30',
    )
  })

  it('às 02:00 da manhã nenhum bloco do dia fechou', () => {
    expect(blocoCandidato(DOIS, 60, sp('2026-10-06', '02:00'))).toBeNull()
  })

  // O passo é int no banco (`janela_valor`). Cada um destes é recusado ANTES do laço: passo
  // fracionário minúsculo nem avançaria o `ini += passoMin` (laço infinito), e fracionário
  // pequeno ladrilharia milhões de blocos. Por isso dá para testar 1e-15 sem pendurar a suíte.
  it.each([
    ['zero', 0],
    ['negativo', -60],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['meio minuto', 0.5],
    ['fracionário grande', 59.9],
    ['fração que não avança o laço', 1e-15],
  ])('passo %s devolve null sem ladrilhar', (_nome, passo) => {
    expect(blocoCandidato(DOIS, passo, sp('2026-10-06', '09:30'))).toBeNull()
  })

  it('agora inválido devolve null em vez de estourar', () => {
    expect(blocoCandidato(DOIS, 60, new Date('xx'))).toBeNull()
    expect(blocoCandidato(DOIS, 60, new Date(Number.NaN))).toBeNull()
  })

  // Único caminho que exercita a hora 24 do ICU: `hour12: false` resolve para o ciclo 'h24' e
  // devolve hour=24 à meia-noite de São Paulo. Com `hourCycle: 'h23'` a hora vem 0–23.
  it('intervalo que começa à meia-noite: às 02:30 o último fechado é 01:00–02:00', () => {
    expect(faixa(blocoCandidato([MEIA_NOITE], 60, sp('2026-10-06', '02:30')))).toBe(
      '2026-10-06 01:00 → 2026-10-06 02:00',
    )
  })

  it('intervalo que começa à meia-noite: às 01:00 o bloco fechado COMEÇA às 00:00', () => {
    expect(faixa(blocoCandidato([MEIA_NOITE], 60, sp('2026-10-06', '01:00')))).toBe(
      '2026-10-06 00:00 → 2026-10-06 01:00',
    )
  })
})

describe('sobraDoIntervalo', () => {
  it('devolve a sobra quando o passo não fecha', () => {
    expect(sobraDoIntervalo(TARDE, 180)).toEqual({ inicio: '16:30', fim: '17:30' })
    expect(sobraDoIntervalo(MANHA, 90)).toEqual({ inicio: '11:30', fim: '12:00' })
  })
  it('devolve null quando o passo fecha redondo', () => {
    expect(sobraDoIntervalo(MANHA, 60)).toBeNull()
    expect(sobraDoIntervalo(TARDE, 240)).toBeNull()
  })
  it.each([
    ['zero', 0],
    ['negativo', -60],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['meio minuto', 0.5],
    ['fracionário grande', 59.9],
    ['fração que não avança o laço', 1e-15],
  ])('passo %s devolve null', (_nome, passo) => {
    expect(sobraDoIntervalo(TARDE, passo)).toBeNull()
  })
})
