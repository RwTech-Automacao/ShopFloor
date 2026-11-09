import { describe, expect, it } from 'vitest'
import {
  lerRegraDoRelatorio, lerSnsParados, montarRelatorioParados, type SnParado,
} from '../parados-relatorio'
import { paradosPorOp } from '../parados'

const AGORA = new Date('2026-10-28T18:05:00Z')
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000)

function sn(pmo: string, op: string, numeroSerie: string, posto: string, dias: number, extra: Partial<SnParado> = {}): SnParado {
  return { pmo, op, posto, reprovada: false, numeroSerie, pecas: 1, em: diasAtras(dias), ...extra }
}

describe('lerRegraDoRelatorio', () => {
  const ok = {
    ok: true,
    regra: {
      id: 'r1', nome: 'Parado 7d', limite_horas: 168, postos: ['Teste', 'Embalagem'], pmos: ['PRT797'],
      so_ops_ativas: true, incluir_manutencao: null, ativa: false,
    },
    turnos: [{ inicio: '07:00:00', fim: '12:00:00' }, { inicio: 'xx', fim: '13:00:00' }, { inicio: '13:30:00', fim: '17:30:00' }],
  }
  it('lê a regra; turno ilegível é ignorado; opção nula vale true (como o avaliador)', () => {
    const r = lerRegraDoRelatorio(ok)
    expect(r).toEqual({
      ok: true,
      valor: {
        id: 'r1', nome: 'Parado 7d', limiteHoras: 168, postos: ['Teste', 'Embalagem'], pmos: ['PRT797'],
        soOpsAtivas: true, incluirManutencao: true, ativa: false,
        turnos: [{ inicio: '07:00', fim: '12:00' }, { inicio: '13:30', fim: '17:30' }],
      },
    })
  })
  it('regra inexistente do banco', () => {
    expect(lerRegraDoRelatorio({ ok: false, motivo: 'regra_inexistente' })).toEqual({ ok: false, motivo: 'regra_inexistente' })
  })
  it('formato estranho é ilegível (nunca "nada parado")', () => {
    expect(lerRegraDoRelatorio(null)).toEqual({ ok: false, motivo: 'resposta_ilegivel' })
    expect(lerRegraDoRelatorio({ ok: true })).toEqual({ ok: false, motivo: 'resposta_ilegivel' })
    expect(lerRegraDoRelatorio({ ...ok, regra: { ...ok.regra, limite_horas: '7' } })).toEqual({ ok: false, motivo: 'resposta_ilegivel' })
  })
})

describe('lerSnsParados', () => {
  it('converte e descarta linha sem PMO/OP/posto/data', () => {
    const r = lerSnsParados([
      { pmo: ' PRT797 ', op: '8563', posto: 'Teste', reprovada: true, numero_serie: 'A1', pecas: 4, em: '2026-10-20T10:00:00Z' },
      { pmo: '', op: '8563', posto: 'Teste', numero_serie: 'A2', pecas: 1, em: '2026-10-20T10:00:00Z' },
      { pmo: 'PRT797', op: '8563', posto: 'Teste', numero_serie: 'A3', pecas: 1, em: 'lixo' },
      { pmo: 'PRT797', op: '8563', posto: 'Teste', numero_serie: 'A4', pecas: null, em: '2026-10-20T10:00:00Z' },
    ])
    expect(r).toEqual([
      { pmo: 'PRT797', op: '8563', posto: 'Teste', reprovada: true, numeroSerie: 'A1', pecas: 4, em: new Date('2026-10-20T10:00:00Z') },
      { pmo: 'PRT797', op: '8563', posto: 'Teste', reprovada: false, numeroSerie: 'A4', pecas: 1, em: new Date('2026-10-20T10:00:00Z') },
    ])
    expect(lerSnsParados(null)).toEqual([])
  })
})

describe('montarRelatorioParados', () => {
  const sns = [
    sn('PMOG13', '9001', 'G1', 'Embalagem', 8),
    sn('PRT797', '8563', 'P3', 'Teste', 10),
    sn('PRT797', '8563', 'P1', 'Teste', 12, { pecas: 4 }),
    sn('PRT797', '8563', 'P2', 'Integração', 11),
    sn('PRT797', '8563', 'P9', 'Teste', 9, { reprovada: true }),
  ]

  it('OPs da mais antiga para a mais nova; a linha de cada OP é a do alerta (paradosPorOp)', () => {
    const r = montarRelatorioParados(sns, [], AGORA)
    expect(r.totalPecas).toBe(8)
    expect(r.expediente).toBe(false)
    expect(r.ops.map((o) => `${o.pmo}/${o.op}:${o.pecas}`)).toEqual(['PRT797/8563:7', 'PMOG13/9001:1'])
    // Os mesmos grupos que a alerta_travados entregaria dão a mesma OP no alerta.
    const doAlerta = paradosPorOp([
      { pmo: 'PRT797', op: '8563', posto: 'Teste', reprovada: false, pecas: 5, em: diasAtras(12), amostras: [] },
      { pmo: 'PRT797', op: '8563', posto: 'Integração', reprovada: false, pecas: 1, em: diasAtras(11), amostras: [] },
      { pmo: 'PRT797', op: '8563', posto: 'Teste', reprovada: true, pecas: 1, em: diasAtras(9), amostras: [] },
      { pmo: 'PMOG13', op: '9001', posto: 'Embalagem', reprovada: false, pecas: 1, em: diasAtras(8), amostras: [] },
    ], [], AGORA)
    expect(r.ops.map(({ pmo, op, maisAntigaMin, expediente, itens }) => ({ pmo, op, maisAntigaMin, expediente, itens })))
      .toEqual(doAlerta)
  })

  it('por OP, os SNs da mais antiga para a mais nova, com a idade de cada um', () => {
    const r = montarRelatorioParados(sns, [], AGORA)
    expect(r.ops[0]!.sns.map((s) => `${s.numeroSerie}:${s.posto}:${s.minutos}`)).toEqual([
      `P1:Teste:${12 * 1440}`, `P2:Integração:${11 * 1440}`, `P3:Teste:${10 * 1440}`, `P9:Teste:${9 * 1440}`,
    ])
    expect(r.ops[0]!.sns[3]!.reprovada).toBe(true)
  })

  it('com turno a idade é de expediente', () => {
    const r = montarRelatorioParados(sns, [{ inicio: '07:00', fim: '17:00' }], AGORA)
    expect(r.expediente).toBe(true)
    expect(r.ops[0]!.sns[0]!.minutos).toBeLessThan(12 * 1440)
    expect(r.ops[0]!.maisAntigaMin).toBe(r.ops[0]!.sns[0]!.minutos)
  })

  it('nada parado', () => {
    expect(montarRelatorioParados([], [], AGORA)).toEqual({ totalPecas: 0, expediente: false, ops: [] })
  })
})
