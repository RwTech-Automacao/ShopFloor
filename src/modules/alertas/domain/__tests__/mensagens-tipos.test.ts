import { describe, it, expect } from 'vitest'
import {
  rotuloDefeito,
  textoAlertaDefeito,
  textoAlertaTempo,
  textoLembreteTipo,
  textoNormalizouDefeito,
  textoNormalizouTempo,
} from '../mensagens'

// 17/09/2026 14:05 em São Paulo
const EM = new Date('2026-09-17T17:05:00Z')

const TEMPO = {
  posto: 'Teste',
  regraNome: 'Teste lento',
  mediaSeg: 180,
  limiteSeg: 120,
  pecas: 11,
  janela: { tipo: 'tempo' as const, valor: 60 },
  em: EM,
}

const DEFEITO = {
  posto: 'Teste',
  regraNome: 'Defeito 3x',
  defeito: '2040 COMPONENTE FALTANDO',
  ocorrencias: 3,
  limite: 3,
  janela: { tipo: 'tempo' as const, valor: 60 },
  em: EM,
}

describe('rotuloDefeito', () => {
  it('número + descrição capitalizada', () => {
    expect(rotuloDefeito('2040 COMPONENTE FALTANDO')).toBe('2040 (Componente Faltando)')
  })
  it('só descrição', () => {
    expect(rotuloDefeito('TRILHA ROMPIDA')).toBe('Trilha Rompida')
  })
  it('só número', () => {
    expect(rotuloDefeito('777')).toBe('777')
  })
})

describe('tempo médio por peça', () => {
  it('alerta', () => {
    expect(textoAlertaTempo(TEMPO)).toBe(
      '🔴 Teste lento: 3:00 por peça na última hora (limite 2:00) · 11 peças\nRegra: Teste lento · 17/09 14:05',
    )
  })
  it('janela da OP em andamento', () => {
    expect(textoAlertaTempo({ ...TEMPO, janela: { tipo: 'op', valor: null, pmo: 'PMOX', op: '7001' } })).toContain(
      '3:00 por peça na OP PMOX/7001 (limite 2:00)',
    )
  })
  it('normalizou', () => {
    expect(textoNormalizouTempo({ posto: 'Teste', mediaSeg: 68.33 })).toBe('🟢 Teste normalizou: 1:08 por peça')
  })
})

describe('defeito repetido', () => {
  it('alerta', () => {
    expect(textoAlertaDefeito(DEFEITO)).toBe(
      '🔴 Defeito 2040 (Componente Faltando) repetido no Teste: 3 vezes na última hora (limite 3)\n' +
        'Regra: Defeito 3x · 17/09 14:05',
    )
  })
  it('janela de 90 minutos', () => {
    expect(textoAlertaDefeito({ ...DEFEITO, janela: { tipo: 'tempo', valor: 90 } })).toContain('3 vezes nos últimos 90 minutos')
  })
  it('normalizou', () => {
    expect(textoNormalizouDefeito({ posto: 'Teste', defeito: '2040 COMPONENTE FALTANDO' })).toBe(
      '🟢 Defeito 2040 (Componente Faltando) normalizou no Teste',
    )
  })
})

describe('lembrete dos tipos novos', () => {
  it('cabeçalho com o tempo desde a abertura, sem "abaixo"', () => {
    expect(textoLembreteTipo('🔴 corpo', new Date('2026-09-17T16:35:00Z'), EM)).toBe(
      '⏰ Lembrete — continua há 30 min\n🔴 corpo',
    )
  })
})
