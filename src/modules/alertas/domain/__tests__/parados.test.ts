import { describe, expect, it } from 'vitest'
import { chaveDaOp, paradosParaBanco, paradosPorOp, type GrupoTravado } from '../parados'

const sp = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`)
const TURNOS = [{ inicio: '07:00', fim: '17:30' }]
const AGORA = sp('2026-10-28', '15:00')

function grupo(p: Partial<GrupoTravado>): GrupoTravado {
  return {
    pmo: 'PRT797', op: '8563', posto: 'Teste', reprovada: false, pecas: 4,
    em: sp('2026-10-28', '10:00'), amostras: ['258001', '258002'], ...p,
  }
}

describe('paradosPorOp', () => {
  it('uma entrada por OP, com um item por posto e o tempo em horas de expediente', () => {
    const r = paradosPorOp(
      [grupo({ posto: 'Teste', em: sp('2026-10-28', '10:00') }),
       grupo({ posto: 'Embalagem', pecas: 2, em: sp('2026-10-28', '09:00') })],
      TURNOS, 'Teste', AGORA)
    expect(r).toHaveLength(1)
    expect(r[0]!.itens.map((i) => i.codigo)).toEqual(['Embalagem', 'Teste']) // o mais antigo primeiro
    expect(r[0]!.itens[1]).toMatchObject({ tipo: 'posto', pecas: 4, minutos: 300 })
    expect(r[0]!.maisAntigaMin).toBe(360)
    expect(r[0]!.expediente).toBe(true)
  })

  it('o posto da ocorrência é o informado (estável), não o do item mais antigo', () => {
    const r = paradosPorOp([grupo({ posto: 'Embalagem' })], TURNOS, 'Inicial', AGORA)
    expect(r[0]!.posto).toBe('Inicial')
  })

  it('peças reprovadas viram item de conserto, separado do mesmo posto', () => {
    const r = paradosPorOp(
      [grupo({ posto: 'Teste' }), grupo({ posto: 'Teste', reprovada: true, pecas: 1 })], TURNOS, 'Teste', AGORA)
    expect(r[0]!.itens.map((i) => i.tipo).sort()).toEqual(['conserto', 'posto'])
  })

  it('agrupa por OP: a OP com a peça mais antiga vem primeiro', () => {
    const r = paradosPorOp(
      [grupo({ op: '8563', em: sp('2026-10-28', '11:00') }),
       grupo({ op: '8564', em: sp('2026-10-28', '08:00') })], TURNOS, 'Teste', AGORA)
    expect(r.map((g) => g.op)).toEqual(['8564', '8563'])
  })

  it('sem turno é relógio corrido e a OP diz que não é expediente', () => {
    const r = paradosPorOp([grupo({ em: sp('2026-10-21', '15:00') })], [], 'Teste', AGORA)
    expect(r[0]!.maisAntigaMin).toBe(7 * 24 * 60)
    expect(r[0]!.expediente).toBe(false)
  })

  it('nada travado devolve lista vazia', () => {
    expect(paradosPorOp([], TURNOS, 'Teste', AGORA)).toEqual([])
  })

  it('amostras de SN viajam no item', () => {
    const r = paradosPorOp([grupo({ amostras: ['A1', 'A2', 'A3'] })], TURNOS, 'Teste', AGORA)
    expect(r[0]!.itens[0]!.amostras).toEqual(['A1', 'A2', 'A3'])
  })
})

describe('paradosParaBanco', () => {
  it('serializa em snake_case, na forma que o alerta_avaliar lê', () => {
    const grupos = paradosPorOp([grupo({ em: sp('2026-10-28', '10:00') })], TURNOS, 'Teste', AGORA)
    expect(paradosParaBanco(grupos)).toEqual([
      {
        pmo: 'PRT797', op: '8563', posto: 'Teste', mais_antiga_min: 300, expediente: true,
        itens: [{ tipo: 'posto', codigo: 'Teste', pecas: 4, minutos: 300, amostras: ['258001', '258002'] }],
      },
    ])
  })
})

describe('chaveDaOp', () => {
  it('é PMO/OP, a mesma que o banco grava na ocorrência', () => {
    expect(chaveDaOp('PRT797', '8563')).toBe('PRT797/8563')
  })
})
