import { describe, expect, it } from 'vitest'
import {
  EXPLICA_METRICAS,
  PARADOS_OPCOES,
  PARADOS_PADRAO,
  faixasPendencias,
  formatarDias,
  paradoDaUrl,
  taxaPorItem,
  urlDosFiltrosComParado,
} from '../dashboard-metricas'
import { FILTROS_LIMPOS } from '../dashboard'

describe('paradoDaUrl', () => {
  it('aceita 3, 7, 15 e 30', () => {
    for (const n of PARADOS_OPCOES) expect(paradoDaUrl({ parado: String(n) })).toBe(n)
  })
  it('padrão 7 quando ausente ou inválido', () => {
    expect(PARADOS_PADRAO).toBe(7)
    expect(paradoDaUrl({})).toBe(7)
    expect(paradoDaUrl({ parado: '5' })).toBe(7)
    expect(paradoDaUrl({ parado: 'abc' })).toBe(7)
    expect(paradoDaUrl({ parado: '' })).toBe(7)
    expect(paradoDaUrl({ parado: '15.5' })).toBe(7)
    expect(paradoDaUrl({ parado: '-3' })).toBe(7)
  })
  it('usa o primeiro valor quando vem repetido', () => {
    expect(paradoDaUrl({ parado: ['30', '3'] })).toBe(30)
  })
})

describe('formatarDias', () => {
  it('vírgula decimal pt-BR e sufixo', () => {
    expect(formatarDias(1.8)).toBe('1,8 d')
    expect(formatarDias(12.34)).toBe('12,3 d')
    expect(formatarDias(0)).toBe('0,0 d')
  })
  it('null vira "—", nunca zero', () => {
    expect(formatarDias(null)).toBe('—')
  })
})

describe('faixasPendencias', () => {
  it('cinco linhas rotuladas, na ordem', () => {
    const l = faixasPendencias({ noPrazo: 100, d1a7: 40, d8a30: 50, d30mais: 30, semPrevista: 9 })
    expect(l.map((x) => x.rotulo)).toEqual([
      'No prazo', '1 a 7 dias', '8 a 30 dias', 'Mais de 30 dias', 'Sem data prevista',
    ])
    expect(l.map((x) => x.valor)).toEqual([100, 40, 50, 30, 9])
  })
})

describe('urlDosFiltrosComParado', () => {
  const AGORA = new Date('2026-10-15T15:00:00Z')
  const f = { ...FILTROS_LIMPOS, de: '2026-07-18', ate: '2026-10-15' }
  it('7 (padrão) não entra na URL', () => {
    expect(urlDosFiltrosComParado({ ...f, emb: 'E1' }, 7, AGORA)).toBe('emb=E1')
    expect(urlDosFiltrosComParado(f, 7, AGORA)).toBe('')
  })
  it('outro valor entra, preservando os filtros', () => {
    expect(urlDosFiltrosComParado({ ...f, emb: 'E1', sinal: 'negativa' }, 15, AGORA)).toBe('emb=E1&sinal=negativa&parado=15')
    expect(urlDosFiltrosComParado(f, 30, AGORA)).toBe('parado=30')
  })
})

describe('taxaPorItem', () => {
  it('reprovados ÷ com resultado, uma casa', () => {
    expect(taxaPorItem(4, 100)).toBe(4)
    expect(taxaPorItem(1, 3)).toBe(33.3)
  })
  it('sem base = null', () => {
    expect(taxaPorItem(0, 0)).toBeNull()
  })
})

describe('EXPLICA_METRICAS', () => {
  it('Pendências e parados avisam que ignoram De e Até', () => {
    expect(EXPLICA_METRICAS.pendencias).toMatch(/ignora De e Até/)
    expect(EXPLICA_METRICAS.parados).toMatch(/ignora De e Até/)
  })
})
