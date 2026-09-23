import { describe, it, expect } from 'vitest'
import { textoDoEnvio } from '../envio'
import { textoReabertura } from '../mensagens'
import { rotuloEstadoOcorrencia } from '../ocorrencia'

/** `dados` como o alerta_avaliar da 0122 grava numa REABERTURA (alerta + os campos da reabertura). */
const COMUNS = {
  posto: 'Teste',
  janela_tipo: 'tempo',
  janela_valor: 60,
  pmo: null,
  op: null,
  aberta_em: '2026-09-23T15:00:00+00:00',
  agora: '2026-09-23T17:05:00+00:00',
  reabertura: true,
  resolvida_por_nome: 'Ana Gestora',
  resolvida_em: '2026-09-23T16:00:00+00:00',
  reaberturas: 1,
}

const APROVACAO = {
  ...COMUNS,
  regra_tipo: 'aprovacao',
  regra_nome: 'Teste abaixo de 90',
  taxa: 75,
  taxa_minima: 90,
  aprovados: 15,
  reprovados: 5,
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

describe('textoReabertura', () => {
  it('diz quem deu como resolvido, há quanto tempo, e que continua fora do limite', () => {
    expect(
      textoReabertura('🔴 corpo do alerta', {
        nome: 'Ana Gestora',
        resolvidaEm: new Date('2026-09-23T16:00:00Z'),
        em: new Date('2026-09-23T17:05:00Z'),
      }),
    ).toBe('🔁 Reaberto — dado como resolvido por Ana Gestora há 1 h 5 min, e continua fora do limite\n🔴 corpo do alerta')
  })

  it('sem nome (quem resolveu foi apagado) fala "alguém"', () => {
    const t = textoReabertura('corpo', {
      nome: '  ',
      resolvidaEm: new Date('2026-09-23T17:00:00Z'),
      em: new Date('2026-09-23T17:05:00Z'),
    })
    expect(t).toContain('dado como resolvido por alguém há 5 min')
  })

  it('sem a data da resolução, sai sem o "há X"', () => {
    const t = textoReabertura('corpo', { nome: 'Ana', resolvidaEm: null, em: new Date('2026-09-23T17:05:00Z') })
    expect(t).toBe('🔁 Reaberto — dado como resolvido por Ana, e continua fora do limite\ncorpo')
  })
})

describe('textoDoEnvio — reabertura nos três tipos', () => {
  it('taxa de aprovação: cabeçalho da reabertura + o alerta normal', () => {
    expect(textoDoEnvio('alerta', APROVACAO)).toBe(
      '🔁 Reaberto — dado como resolvido por Ana Gestora há 1 h 5 min, e continua fora do limite\n' +
        '🔴 Teste abaixo da meta\n' +
        'Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados\n' +
        'Regra: Teste abaixo de 90 · 23/09 14:05',
    )
  })

  it('tempo médio por peça', () => {
    expect(textoDoEnvio('alerta', TEMPO)).toBe(
      '🔁 Reaberto — dado como resolvido por Ana Gestora há 1 h 5 min, e continua fora do limite\n' +
        '🔴 Teste lento: 3:00 por peça na última hora (limite 2:00) · 11 peças\n' +
        'Regra: Teste lento · 23/09 14:05',
    )
  })

  it('defeito repetido', () => {
    expect(textoDoEnvio('alerta', DEFEITO)).toMatch(
      /^🔁 Reaberto — dado como resolvido por Ana Gestora há 1 h 5 min, e continua fora do limite\n🔴 Defeito 2040/,
    )
  })

  it('sem a marca de reabertura, o texto é exatamente o do alerta normal', () => {
    const semMarca = { ...TEMPO, reabertura: undefined, resolvida_por_nome: undefined, resolvida_em: undefined }
    expect(textoDoEnvio('alerta', semMarca)).toBe(
      '🔴 Teste lento: 3:00 por peça na última hora (limite 2:00) · 11 peças\nRegra: Teste lento · 23/09 14:05',
    )
  })

  it('a marca só vale no alerta: lembrete e normalizou seguem iguais', () => {
    expect(textoDoEnvio('lembrete', TEMPO)).toMatch(/^⏰ Lembrete/)
    expect(textoDoEnvio('normalizou', TEMPO)).toBe('🟢 Teste normalizou: 3:00 por peça')
  })
})

describe('rotuloEstadoOcorrencia', () => {
  it('aberta sem reabertura continua "Aberta"', () => {
    expect(rotuloEstadoOcorrencia({ estado: 'aberta', reaberturas: 0 })).toBe('Aberta')
  })
  it('aberta depois de uma reabertura vira "Reaberta"', () => {
    expect(rotuloEstadoOcorrencia({ estado: 'aberta', reaberturas: 1 })).toBe('Reaberta')
  })
  it('mais de uma reabertura mostra a contagem', () => {
    expect(rotuloEstadoOcorrencia({ estado: 'aberta', reaberturas: 3 })).toBe('Reaberta 3x')
  })
  it('resolvida e normalizada não mudam de rótulo', () => {
    expect(rotuloEstadoOcorrencia({ estado: 'resolvida', reaberturas: 2 })).toBe('Resolvida')
    expect(rotuloEstadoOcorrencia({ estado: 'normalizada', reaberturas: 2 })).toBe('Normalizada')
  })
})
