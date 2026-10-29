import { describe, expect, it } from 'vitest'
import { chaveDaOp, paradosParaBanco, paradosPorOp, type ItemPendente } from '../parados'

const sp = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`)
const TURNOS = [{ inicio: '07:00', fim: '17:30' }]
const AGORA = sp('2026-10-28', '15:00')

function item(p: Partial<ItemPendente>): ItemPendente {
  return {
    pmo: 'PRT797', op: '8563', posto: 'ALMOX', tipo: 'caixa', codigo: 'CX[1][500]',
    pecas: 500, em: sp('2026-10-28', '10:00'), ...p,
  }
}

describe('paradosPorOp', () => {
  it('só entra o que passou do limite de horas de expediente', () => {
    const r = paradosPorOp(
      [item({ codigo: 'CX[1][500]', em: sp('2026-10-28', '10:00') }), // 5 h
       item({ codigo: 'CX[2][500]', em: sp('2026-10-28', '14:00') })], // 1 h
      TURNOS, 2, AGORA)
    expect(r).toHaveLength(1)
    expect(r[0]!.itens.map((i) => i.codigo)).toEqual(['CX[1][500]'])
    expect(r[0]!.maisAntigaMin).toBe(300)
  })

  it('exatamente no limite conta como parado', () => {
    const r = paradosPorOp([item({ em: sp('2026-10-28', '13:00') })], TURNOS, 2, AGORA)
    expect(r).toHaveLength(1)
  })

  it('agrupa por OP, itens do mais antigo para o mais novo', () => {
    const r = paradosPorOp(
      [item({ codigo: 'CX[3]', em: sp('2026-10-28', '11:00') }),
       item({ codigo: 'CX[4]', em: sp('2026-10-28', '09:00') }),
       item({ op: '8564', codigo: 'CX[1]', em: sp('2026-10-28', '08:00') })],
      TURNOS, 2, AGORA)
    expect(r.map((g) => g.op)).toEqual(['8564', '8563']) // OP com o item mais antigo primeiro
    expect(r[1]!.itens.map((i) => i.codigo)).toEqual(['CX[4]', 'CX[3]'])
  })

  it('o tipo de item e as placas viajam junto', () => {
    const r = paradosPorOp(
      [item({ tipo: 'lote', codigo: 'LOTE-7', pecas: 100, em: sp('2026-10-28', '08:00') })],
      TURNOS, 2, AGORA)
    expect(r[0]!.itens[0]).toMatchObject({ tipo: 'lote', codigo: 'LOTE-7', pecas: 100 })
  })

  it('nada parado devolve lista vazia', () => {
    expect(paradosPorOp([], TURNOS, 2, AGORA)).toEqual([])
    expect(paradosPorOp([item({ em: sp('2026-10-28', '14:59') })], TURNOS, 2, AGORA)).toEqual([])
  })

  it('sem turno conta relógio corrido', () => {
    const r = paradosPorOp([item({ em: sp('2026-10-28', '12:30') })], [], 2, AGORA)
    expect(r[0]!.maisAntigaMin).toBe(150)
  })
})

describe('paradosParaBanco', () => {
  it('serializa em snake_case, na forma que o alerta_avaliar lê', () => {
    const grupos = paradosPorOp([item({ em: sp('2026-10-28', '10:00') })], TURNOS, 2, AGORA)
    expect(paradosParaBanco(grupos)).toEqual([
      {
        pmo: 'PRT797', op: '8563', posto: 'ALMOX', mais_antiga_min: 300,
        itens: [{ tipo: 'caixa', codigo: 'CX[1][500]', pecas: 500, minutos: 300 }],
      },
    ])
  })
})

describe('chaveDaOp', () => {
  it('é PMO/OP, a mesma que o banco grava na ocorrência', () => {
    expect(chaveDaOp('PRT797', '8563')).toBe('PRT797/8563')
  })
})
