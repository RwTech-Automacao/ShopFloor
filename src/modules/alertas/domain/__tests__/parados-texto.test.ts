import { describe, expect, it } from 'vitest'
import { formatarMinutos, formatarTempoParado, textoAlertaParado, textoNormalizouParado } from '../parados-texto'

const AGORA = new Date('2026-10-28T18:05:00Z') // 15:05 em São Paulo

describe('formatarMinutos', () => {
  it('menos de uma hora', () => expect(formatarMinutos(45)).toBe('45 min'))
  it('hora cheia', () => expect(formatarMinutos(120)).toBe('2 h'))
  it('hora e minutos com zero à esquerda', () => expect(formatarMinutos(125)).toBe('2 h 05 min'))
})

describe('formatarTempoParado', () => {
  it('relógio corrido de dois dias para cima vira dias e horas', () => {
    expect(formatarTempoParado(9 * 24 * 60 + 2 * 60, false)).toBe('9 d 2 h')
    expect(formatarTempoParado(7 * 24 * 60, false)).toBe('7 d')
    expect(formatarTempoParado(30 * 60, false)).toBe('30 h') // abaixo de 48 h fica em horas
  })
  it('expediente fica em horas (dia de expediente não é dia de calendário)', () => {
    expect(formatarTempoParado(9 * 24 * 60, true)).toBe('216 h')
  })
})

const base = {
  regraNome: 'Parado ou travado', pmo: 'PRT797', op: '8563', limiteHoras: 168, em: AGORA, expediente: false,
}

describe('textoAlertaParado', () => {
  it('cabeçalho com a OP, o total de peças e o limite; uma linha por posto com exemplos', () => {
    const t = textoAlertaParado({
      ...base,
      itens: [
        { tipo: 'posto', codigo: 'Teste', pecas: 8, minutos: 9 * 1440, amostras: ['258001', '258002', '258003'] },
        { tipo: 'posto', codigo: 'Embalagem', pecas: 1, minutos: 8 * 1440 + 180, amostras: ['258100'] },
      ],
    })
    const linhas = t.split('\n')
    expect(linhas[0]).toBe('⚠️ Parado na produção: OP PRT797/8563 com 9 peças paradas (limite 168 h)')
    expect(t).toContain('• Teste · 8 peças · a mais antiga há 9 d · ex.: 258001, 258002, 258003')
    expect(t).toContain('• Embalagem · 1 peça · a mais antiga há 8 d 3 h · ex.: 258100')
    expect(t).toContain('Regra: Parado ou travado · 28/10 15:05')
  })

  it('singular, e "de expediente" no limite quando a regra tem turno', () => {
    const t = textoAlertaParado({
      ...base, expediente: true, limiteHoras: 8,
      itens: [{ tipo: 'posto', codigo: 'Teste', pecas: 1, minutos: 600, amostras: [] }],
    })
    expect(t.split('\n')[0]).toBe('⚠️ Parado na produção: OP PRT797/8563 com 1 peça parada (limite 8 h de expediente)')
    expect(t).toContain('• Teste · 1 peça · a mais antiga há 10 h')
    expect(t).not.toContain('ex.:')
  })

  it('peças reprovadas dizem que aguardam conserto', () => {
    const t = textoAlertaParado({
      ...base,
      itens: [{ tipo: 'conserto', codigo: 'Teste', pecas: 2, minutos: 9000, amostras: ['X1'] }],
    })
    expect(t).toContain('• Teste (reprovadas, aguardando conserto) · 2 peças')
  })

  it('nunca passa de 2000 caracteres, com aviso do que ficou de fora', () => {
    const itens = Array.from({ length: 200 }, (_, i) => ({
      tipo: 'posto' as const, codigo: `Posto ${i + 1}`, pecas: 3, minutos: 20000 - i, amostras: ['A1', 'A2', 'A3'],
    }))
    const t = textoAlertaParado({ ...base, itens })
    expect(t.length).toBeLessThanOrEqual(2000 - 160)
    expect(t).toContain('… e mais')
    expect(t).toContain('600 peças paradas')
  })
})

describe('textoNormalizouParado', () => {
  it('diz que a OP não tem mais nada parado', () => {
    expect(textoNormalizouParado({ pmo: 'PRT797', op: '8563' })).toBe(
      '🟢 Parado na produção: OP PRT797/8563 sem peças paradas',
    )
  })
})
