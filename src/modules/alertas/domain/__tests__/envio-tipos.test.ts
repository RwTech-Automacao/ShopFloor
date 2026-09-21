import { describe, it, expect } from 'vitest'
import { DadosEnvioInvalidos, textoDoEnvio } from '../envio'

/** `dados` como o alerta_avaliar da 0115 grava para cada tipo. */
const COMUNS = {
  posto: 'Teste',
  janela_tipo: 'tempo',
  janela_valor: 60,
  pmo: null,
  op: null,
  aberta_em: '2026-09-17T16:35:00+00:00',
  agora: '2026-09-17T17:05:00+00:00',
}

const TEMPO = {
  ...COMUNS,
  regra_tipo: 'tempo',
  regra_nome: 'Teste lento',
  media_seg: 180,
  limite_tempo_seg: 120,
  pecas: 11,
}

const DEFEITO = {
  ...COMUNS,
  regra_tipo: 'defeito',
  regra_nome: 'Defeito 3x',
  defeito: '2040 COMPONENTE FALTANDO',
  ocorrencias: 3,
  limite_ocorrencias: 3,
}

describe('textoDoEnvio — tempo médio por peça', () => {
  it('alerta', () => {
    expect(textoDoEnvio('alerta', TEMPO)).toBe(
      '🔴 Teste lento: 3:00 por peça na última hora (limite 2:00) · 11 peças\nRegra: Teste lento · 17/09 14:05',
    )
  })
  it('lembrete', () => {
    expect(textoDoEnvio('lembrete', TEMPO)).toMatch(/^⏰ Lembrete — continua há 30 min\n🔴 Teste lento: 3:00 por peça/)
  })
  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...TEMPO, media_seg: 68.33 })).toBe('🟢 Teste normalizou: 1:09 por peça')
  })
  it('janela da OP guardada', () => {
    expect(textoDoEnvio('alerta', { ...TEMPO, janela_tipo: 'op', janela_valor: null, pmo: 'PMOX', op: '7001' })).toContain(
      'na OP PMOX/7001',
    )
  })
  it('sem a média, não monta', () => {
    expect(() => textoDoEnvio('alerta', { ...TEMPO, media_seg: null })).toThrow(DadosEnvioInvalidos)
  })
})

describe('textoDoEnvio — defeito repetido', () => {
  it('alerta', () => {
    expect(textoDoEnvio('alerta', DEFEITO)).toBe(
      '🔴 Defeito 2040 (Componente Faltando) repetido no Teste: 3 vezes na última hora (limite 3)\n' +
        'Regra: Defeito 3x · 17/09 14:05',
    )
  })
  it('lembrete', () => {
    expect(textoDoEnvio('lembrete', DEFEITO)).toMatch(/^⏰ Lembrete — continua há 30 min\n🔴 Defeito 2040/)
  })
  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...DEFEITO, ocorrencias: 0 })).toBe(
      '🟢 Defeito 2040 (Componente Faltando) normalizou no Teste',
    )
  })
  it('sem o defeito, não monta', () => {
    expect(() => textoDoEnvio('alerta', { ...DEFEITO, defeito: '' })).toThrow(DadosEnvioInvalidos)
  })
})

describe('textoDoEnvio — tipo da regra', () => {
  it('tipo desconhecido não monta', () => {
    expect(() => textoDoEnvio('alerta', { ...TEMPO, regra_tipo: 'lua' })).toThrow(DadosEnvioInvalidos)
  })
  it('sem regra_tipo = taxa de aprovação (fila de antes da 0115)', () => {
    const t = textoDoEnvio('alerta', {
      ...COMUNS,
      regra_nome: 'Teste abaixo de 90',
      taxa: 75,
      taxa_minima: 90,
      aprovados: 15,
      reprovados: 5,
    })
    expect(t).toBe(
      '🔴 Teste abaixo da meta\n' +
        'Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados\n' +
        'Regra: Teste abaixo de 90 · 17/09 14:05',
    )
  })
  it('regra_tipo aprovacao explícito dá o mesmo texto', () => {
    const dados = { ...COMUNS, regra_nome: 'R', taxa: 75, taxa_minima: 90, aprovados: 15, reprovados: 5 }
    expect(textoDoEnvio('alerta', { ...dados, regra_tipo: 'aprovacao' })).toBe(textoDoEnvio('alerta', dados))
  })
})
