import { describe, expect, it } from 'vitest'
import { formatarHhMm, lerHhMm, validarIntervalos } from '../intervalos'

describe('lerHhMm', () => {
  it('lê hora do dia em minutos', () => {
    expect(lerHhMm('07:00')).toBe(420)
    expect(lerHhMm('13:30')).toBe(810)
    expect(lerHhMm('00:00')).toBe(0)
    expect(lerHhMm('23:59')).toBe(1439)
  })
  it('recusa o que não é hora do dia', () => {
    for (const ruim of ['', '7:00', '07:0', '24:00', '07:60', 'ab:cd', '07-00', null, 7, undefined]) {
      expect(lerHhMm(ruim)).toBeNull()
    }
  })
})

describe('formatarHhMm', () => {
  it('devolve sempre com 2 dígitos', () => {
    expect(formatarHhMm(420)).toBe('07:00')
    expect(formatarHhMm(810)).toBe('13:30')
    expect(formatarHhMm(0)).toBe('00:00')
  })
})

describe('validarIntervalos', () => {
  const bons = [{ inicio: '07:00', fim: '12:00' }, { inicio: '13:30', fim: '17:30' }]

  it('aceita os dois turnos do exemplo', () => {
    const r = validarIntervalos(bons, 60)
    expect(r).toEqual({ ok: true, valor: bons })
  })

  it('recusa lista vazia', () => {
    expect(validarIntervalos([], 60)).toEqual({ ok: false, erro: 'Cadastre pelo menos 1 intervalo de horário.' })
  })

  it('recusa o que não é lista', () => {
    expect(validarIntervalos(null, 60).ok).toBe(false)
    expect(validarIntervalos('07:00', 60).ok).toBe(false)
  })

  it('recusa turno que passa da meia-noite', () => {
    expect(validarIntervalos([{ inicio: '22:00', fim: '06:00' }], 60)).toEqual({
      ok: false,
      erro: 'O horário final precisa ser maior que o inicial. Turno que passa da meia-noite não é suportado.',
    })
  })

  it('recusa fim igual ao início', () => {
    expect(validarIntervalos([{ inicio: '07:00', fim: '07:00' }], 60).ok).toBe(false)
  })

  it('recusa intervalo mais curto que 15 minutos', () => {
    expect(validarIntervalos([{ inicio: '07:00', fim: '07:10' }], 15)).toEqual({
      ok: false,
      erro: 'Cada intervalo precisa ter no mínimo 15 minutos.',
    })
  })

  it('recusa sobreposição', () => {
    expect(
      validarIntervalos([{ inicio: '07:00', fim: '12:00' }, { inicio: '11:00', fim: '15:00' }], 60),
    ).toEqual({ ok: false, erro: 'Os intervalos 07:00–12:00 e 11:00–15:00 se sobrepõem.' })
  })

  it('aceita intervalos que apenas se tocam', () => {
    expect(validarIntervalos([{ inicio: '07:00', fim: '12:00' }, { inicio: '12:00', fim: '17:00' }], 60).ok).toBe(true)
  })

  it('acha a sobreposição mesmo fora de ordem', () => {
    expect(validarIntervalos([{ inicio: '13:00', fim: '17:00' }, { inicio: '07:00', fim: '14:00' }], 60).ok).toBe(false)
  })

  it('recusa passo abaixo de 15 minutos', () => {
    expect(validarIntervalos(bons, 10)).toEqual({
      ok: false,
      erro: 'O passo precisa ter no mínimo 15 minutos.',
    })
  })

  it('recusa passo maior que o menor intervalo', () => {
    // menor intervalo = 13:30–17:30 = 240 min
    expect(validarIntervalos(bons, 300)).toEqual({
      ok: false,
      erro: 'O passo (5 h) não cabe no menor intervalo cadastrado (13:30–17:30, 4 h).',
    })
  })

  it('aceita passo igual ao menor intervalo', () => {
    expect(validarIntervalos(bons, 240).ok).toBe(true)
  })

  it('sem passo informado, só confere os intervalos', () => {
    expect(validarIntervalos(bons, null).ok).toBe(true)
    expect(validarIntervalos([{ inicio: '22:00', fim: '06:00' }], null).ok).toBe(false)
  })

  it('devolve os intervalos ORDENADOS pelo início', () => {
    const r = validarIntervalos([{ inicio: '13:30', fim: '17:30' }, { inicio: '07:00', fim: '12:00' }], 60)
    expect(r.ok && r.valor).toEqual([{ inicio: '07:00', fim: '12:00' }, { inicio: '13:30', fim: '17:30' }])
  })

  it('apara espaço e ignora duplicata exata', () => {
    const r = validarIntervalos([{ inicio: ' 07:00 ', fim: '12:00' }, { inicio: '07:00', fim: '12:00' }], 60)
    expect(r.ok && r.valor).toEqual([{ inicio: '07:00', fim: '12:00' }])
  })
})
