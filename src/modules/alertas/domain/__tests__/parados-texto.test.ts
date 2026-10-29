import { describe, expect, it } from 'vitest'
import { formatarMinutos, textoAlertaParado, textoNormalizouParado } from '../parados-texto'

const AGORA = new Date('2026-10-28T18:05:00Z') // 15:05 em São Paulo

describe('formatarMinutos', () => {
  it('menos de uma hora', () => expect(formatarMinutos(45)).toBe('45 min'))
  it('hora cheia', () => expect(formatarMinutos(120)).toBe('2 h'))
  it('hora e minutos com zero à esquerda', () => expect(formatarMinutos(125)).toBe('2 h 05 min'))
})

const base = {
  regraNome: 'Parado no Almox', pmo: 'PRT797', op: '8563', limiteHoras: 2, em: AGORA,
}

describe('textoAlertaParado', () => {
  it('lista cada caixa, com placas e o tempo, e dá o rótulo da OP', () => {
    const t = textoAlertaParado({
      ...base,
      itens: [
        { tipo: 'caixa', codigo: 'CX[3][500]', pecas: 500, minutos: 190 },
        { tipo: 'caixa', codigo: 'CX[4][500]', pecas: 500, minutos: 125 },
      ],
    })
    expect(t).toContain('OP PRT797/8563')
    expect(t).toContain('2 itens parados')
    expect(t).toContain('limite 2 h de expediente')
    expect(t).toContain('• CX[3][500] · 500 placas · 3 h 10 min')
    expect(t).toContain('• CX[4][500] · 500 placas · 2 h 05 min')
    expect(t).toContain('Regra: Parado no Almox · 28/10 15:05')
  })

  it('singular quando é um item só', () => {
    const t = textoAlertaParado({
      ...base, itens: [{ tipo: 'caixa', codigo: 'CX[1][500]', pecas: 500, minutos: 130 }],
    })
    expect(t).toContain('1 item parado')
  })

  it('lote leva o código do lote e peças avulsas dizem "a mais antiga"', () => {
    const t = textoAlertaParado({
      ...base,
      itens: [
        { tipo: 'lote', codigo: 'LOTE 7', pecas: 100, minutos: 200 },
        { tipo: 'peca', codigo: 'AVULSAS', pecas: 37, minutos: 180 },
      ],
    })
    expect(t).toContain('• Lote LOTE 7 · 100 placas · 3 h 20 min')
    expect(t).toContain('• Peças avulsas · 37 placas · a mais antiga há 3 h')
  })

  it('nunca passa de 2000 caracteres, com aviso do que ficou de fora', () => {
    const itens = Array.from({ length: 200 }, (_, i) => ({
      tipo: 'caixa' as const, codigo: `CX[${i + 1}][500]`, pecas: 500, minutos: 600 - i,
    }))
    const t = textoAlertaParado({ ...base, itens })
    expect(t.length).toBeLessThanOrEqual(2000 - 160) // folga do cabeçalho de lembrete/reabertura
    expect(t).toContain('… e mais')
    expect(t).toContain('200 itens parados')
  })
})

describe('textoNormalizouParado', () => {
  it('diz que a OP não tem mais nada parado', () => {
    expect(textoNormalizouParado({ pmo: 'PRT797', op: '8563' })).toBe(
      '🟢 Almoxarifado: OP PRT797/8563 sem itens parados',
    )
  })
})
