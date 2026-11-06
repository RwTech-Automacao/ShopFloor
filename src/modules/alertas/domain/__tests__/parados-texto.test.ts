import { describe, expect, it } from 'vitest'
import {
  formatarIdadeParado, formatarLimiteParado, formatarMinutos, textoNormalizouParado, textoRelatorioParado,
  type OpParada,
} from '../parados-texto'

const AGORA = new Date('2026-10-28T18:05:00Z') // 15:05 em São Paulo

describe('formatarMinutos', () => {
  it('menos de uma hora', () => expect(formatarMinutos(45)).toBe('45 min'))
  it('hora cheia', () => expect(formatarMinutos(120)).toBe('2 h'))
  it('hora e minutos com zero à esquerda', () => expect(formatarMinutos(125)).toBe('2 h 05 min'))
})

describe('formatarIdadeParado', () => {
  it('relógio corrido: de 1 dia para cima vira Nd (dias inteiros)', () => {
    expect(formatarIdadeParado(9 * 1440 + 120, false)).toBe('9d')
    expect(formatarIdadeParado(1440, false)).toBe('1d')
    expect(formatarIdadeParado(300, false)).toBe('5 h')
  })
  it('expediente fica em horas (dia de expediente não é dia de calendário)', () => {
    expect(formatarIdadeParado(9 * 1440, true)).toBe('216 h')
  })
})

describe('formatarLimiteParado', () => {
  it('múltiplo de 24 h vira dias', () => {
    expect(formatarLimiteParado(168, false)).toBe('7 dias')
    expect(formatarLimiteParado(24, false)).toBe('1 dia')
  })
  it('senão fica em horas, e diz quando é de expediente', () => {
    expect(formatarLimiteParado(36, false)).toBe('36 h')
    expect(formatarLimiteParado(8, true)).toBe('8 h de expediente')
    expect(formatarLimiteParado(168, true)).toBe('7 dias de expediente')
  })
})

const dia = 1440
function op(n: number, extra: Partial<OpParada> = {}): OpParada {
  return {
    pmo: 'PRT797', op: String(8000 + n), maisAntigaMin: (400 - n) * dia,
    itens: [{ tipo: 'posto', codigo: 'Teste', pecas: 3, minutos: (400 - n) * dia }], ...extra,
  }
}
const base = { regraNome: 'Parado ou travado', limiteHoras: 168, expediente: false, em: AGORA }

describe('textoRelatorioParado', () => {
  it('uma OP: assunto no singular, a linha da OP e o rodapé', () => {
    const t = textoRelatorioParado({
      ...base,
      ops: [{
        pmo: 'PRT797', op: '8563', maisAntigaMin: 9 * dia + 180,
        itens: [
          { tipo: 'posto', codigo: 'Teste', pecas: 1, minutos: 9 * dia + 180 },
        ],
      }],
    })
    expect(t.split('\n')).toEqual([
      '⏰ 1 peça parada há mais de 7 dias em 1 OP',
      'PRT797/8563 · 1 peça · mais antiga há 9d · Teste (1)',
      'Regra: Parado ou travado · 28/10 15:05',
    ])
  })

  it('3 OPs: da mais antiga para a mais nova, vários postos e a linha das reprovadas', () => {
    const t = textoRelatorioParado({
      ...base,
      ops: [
        { pmo: 'PMOG13', op: '9001', maisAntigaMin: 8 * dia, itens: [{ tipo: 'posto', codigo: 'Embalagem', pecas: 2, minutos: 8 * dia }] },
        {
          pmo: 'PRT797', op: '8563', maisAntigaMin: 12 * dia,
          itens: [
            { tipo: 'posto', codigo: 'Teste', pecas: 5, minutos: 12 * dia },
            { tipo: 'posto', codigo: 'Integração', pecas: 2, minutos: 10 * dia },
            { tipo: 'conserto', codigo: 'Teste', pecas: 1, minutos: 9 * dia },
          ],
        },
        { pmo: 'PRT800', op: '8700', maisAntigaMin: 10 * dia, itens: [{ tipo: 'posto', codigo: 'Teste', pecas: 4, minutos: 10 * dia }] },
      ],
    })
    expect(t).toBe([
      '⏰ 14 peças paradas há mais de 7 dias em 3 OPs',
      'PRT797/8563 · 8 peças · mais antiga há 12d · Teste (5), Integração (2)',
      '   ↳ reprovadas, aguardando conserto: Teste (1)',
      'PRT800/8700 · 4 peças · mais antiga há 10d · Teste (4)',
      'PMOG13/9001 · 2 peças · mais antiga há 8d · Embalagem (2)',
      'Regra: Parado ou travado · 28/10 15:05',
    ].join('\n'))
  })

  it('só reprovadas: a linha da OP não tem trecho de postos', () => {
    const t = textoRelatorioParado({
      ...base,
      ops: [{ pmo: 'PRT797', op: '8563', maisAntigaMin: 8 * dia, itens: [{ tipo: 'conserto', codigo: 'Teste', pecas: 2, minutos: 8 * dia }] }],
    })
    expect(t).toContain('PRT797/8563 · 2 peças · mais antiga há 8d\n   ↳ reprovadas, aguardando conserto: Teste (2)')
  })

  it('limite em horas e expediente no assunto; idade em horas no expediente', () => {
    const t = textoRelatorioParado({ ...base, limiteHoras: 8, expediente: true, ops: [op(1, { maisAntigaMin: 600 })] })
    expect(t.split('\n')[0]).toBe('⏰ 3 peças paradas há mais de 8 h de expediente em 1 OP')
    expect(t).toContain('mais antiga há 10 h')
  })

  it('20 OPs cabem inteiras, sem corte, ordenadas da mais antiga para a mais nova', () => {
    const ops = Array.from({ length: 20 }, (_, i) => op(i)).reverse()
    const t = textoRelatorioParado({ ...base, ops })
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(t).not.toContain('… e mais')
    expect(t.split('\n')[0]).toBe('⏰ 60 peças paradas há mais de 7 dias em 20 OPs')
    const ordem = [...t.matchAll(/PRT797\/(\d+)/g)].map((m) => Number(m[1]))
    expect(ordem).toEqual(Array.from({ length: 20 }, (_, i) => 8000 + i))
  })

  it('300 OPs: corta no limite de 2000 com "… e mais K OPs", e cabeçalho e rodapé ficam', () => {
    const ops = Array.from({ length: 300 }, (_, i) => op(i))
    const t = textoRelatorioParado({ ...base, ops })
    expect(t.length).toBeLessThanOrEqual(2000)
    const linhas = t.split('\n')
    expect(linhas[0]).toBe('⏰ 900 peças paradas há mais de 7 dias em 300 OPs')
    expect(linhas[linhas.length - 1]).toBe('Regra: Parado ou travado · 28/10 15:05')
    const corte = linhas.find((l) => l.startsWith('… e mais') || l.includes('… e mais'))
    expect(corte).toMatch(/… e mais (\d+) OPs$/)
    const mostradas = linhas.filter((l) => l.startsWith('PRT797/')).length
    const k = Number(/… e mais (\d+) OPs/.exec(t)![1])
    expect(mostradas + k).toBe(300)
    expect(linhas[1]).toContain('PRT797/8000') // a mais antiga primeiro
  })

  it('deixa 160 caracteres de margem para o cabeçalho da reabertura', () => {
    const t = textoRelatorioParado({ ...base, ops: Array.from({ length: 300 }, (_, i) => op(i)) })
    expect(t.length).toBeLessThanOrEqual(1840)
  })
})

describe('textoNormalizouParado', () => {
  it('diz que não há mais nada parado', () => {
    expect(textoNormalizouParado()).toBe('🟢 Parado na produção: sem peças paradas')
  })
})
