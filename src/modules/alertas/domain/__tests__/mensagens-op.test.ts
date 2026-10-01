import { describe, it, expect } from 'vitest'
import { textoDoEnvio } from '../envio'
import { textoOp } from '../mensagens'

/**
 * O PMO e a OP em TODOS os alertas: quem recebe no celular não sabia de qual ordem a mensagem
 * falava. Os testes entram pelo `textoDoEnvio` — é o contrato de verdade, o `dados` que o
 * `alerta_avaliar` põe na fila.
 */

/** `dados` como o alerta_avaliar grava, agora com a ordem preenchida. */
const COMUNS = {
  posto: 'Teste',
  janela_tipo: 'tempo',
  janela_valor: 60,
  pmo: 'PMOG01',
  op: '8504',
  aberta_em: '2026-09-17T16:35:00+00:00',
  agora: '2026-09-17T17:05:00+00:00',
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

describe('textoOp', () => {
  it('PMO e OP juntos', () => {
    expect(textoOp({ pmo: 'PMOG01', op: '8504' })).toBe('PMOG01/8504')
  })
  it('só a OP', () => {
    expect(textoOp({ pmo: null, op: '8504' })).toBe('8504')
  })
  it('só o PMO', () => {
    expect(textoOp({ pmo: 'PMOG01', op: '' })).toBe('PMOG01')
  })
  it('nenhum dos dois — vazio, para o chamador omitir o trecho', () => {
    expect(textoOp({ pmo: null, op: null })).toBe('')
  })
})

describe('a ordem aparece em cada tipo de regra', () => {
  it('taxa de aprovação: alerta', () => {
    expect(textoDoEnvio('alerta', APROVACAO)).toBe(
      '🔴 Teste abaixo da meta\n' +
        'OP PMOG01/8504\n' +
        'Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados\n' +
        'Regra: Teste abaixo de 90 · 17/09 14:05',
    )
  })
  it('taxa de aprovação: lembrete', () => {
    expect(textoDoEnvio('lembrete', APROVACAO)).toContain('\nOP PMOG01/8504\n')
  })
  it('taxa de aprovação: normalizou', () => {
    expect(textoDoEnvio('normalizou', APROVACAO)).toBe(
      '🟢 Teste normalizou: 75,0% (ficou 30 min abaixo) · OP PMOG01/8504',
    )
  })
  it('tempo médio por peça: alerta', () => {
    expect(textoDoEnvio('alerta', TEMPO)).toBe(
      '🔴 Teste lento: 3:00 por peça na última hora (limite 2:00) · 11 peças\n' +
        'OP PMOG01/8504\n' +
        'Regra: Teste lento · 17/09 14:05',
    )
  })
  it('tempo médio por peça: normalizou', () => {
    expect(textoDoEnvio('normalizou', TEMPO)).toBe('🟢 Teste normalizou: 3:00 por peça · OP PMOG01/8504')
  })
  it('defeito repetido: alerta', () => {
    expect(textoDoEnvio('alerta', DEFEITO)).toBe(
      '🔴 Defeito 2040 (Componente Faltando) repetido no Teste: 3 vezes na última hora (limite 3)\n' +
        'OP PMOG01/8504\n' +
        'Regra: Defeito 3x · 17/09 14:05',
    )
  })
  it('defeito repetido: normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...DEFEITO, ocorrencias: 0 })).toBe(
      '🟢 Defeito 2040 (Componente Faltando) normalizou no Teste · OP PMOG01/8504',
    )
  })
  it('resolvido', () => {
    expect(
      textoDoEnvio('resolvido', {
        posto: 'Teste',
        resolvida_por_nome: 'Ana Gestora',
        resolvida_em: '2026-09-17T17:05:00+00:00',
        pmo: 'PMOG01',
        op: '8504',
      }),
    ).toBe('✅ Teste: resolvido por Ana Gestora às 14:05 · OP PMOG01/8504')
  })
  it('reabertura: o cabeçalho envolve o alerta, que continua dizendo a ordem', () => {
    const t = textoDoEnvio('alerta', {
      ...APROVACAO,
      reabertura: true,
      resolvida_por_nome: 'Ana Gestora',
      resolvida_em: '2026-09-17T16:45:00+00:00',
    })
    expect(t).toMatch(/^🔁 Reaberto/)
    expect(t).toContain('\nOP PMOG01/8504\n')
  })
})

describe('sem a ordem gravada, a mensagem sai como antes', () => {
  const semOp = { pmo: null, op: null }
  it('alerta de aprovação não ganha linha vazia', () => {
    expect(textoDoEnvio('alerta', { ...APROVACAO, ...semOp })).toBe(
      '🔴 Teste abaixo da meta\n' +
        'Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados\n' +
        'Regra: Teste abaixo de 90 · 17/09 14:05',
    )
  })
  it('normalizou não fica com rabo " · OP "', () => {
    expect(textoDoEnvio('normalizou', { ...TEMPO, ...semOp })).toBe('🟢 Teste normalizou: 3:00 por peça')
  })
  it('alerta de defeito não ganha linha vazia', () => {
    expect(textoDoEnvio('alerta', { ...DEFEITO, ...semOp })).toBe(
      '🔴 Defeito 2040 (Componente Faltando) repetido no Teste: 3 vezes na última hora (limite 3)\n' +
        'Regra: Defeito 3x · 17/09 14:05',
    )
  })
  it('resolvido sem ordem (linha antiga da fila)', () => {
    expect(
      textoDoEnvio('resolvido', {
        posto: 'Teste',
        resolvida_por_nome: 'Ana Gestora',
        resolvida_em: '2026-09-17T17:05:00+00:00',
      }),
    ).toBe('✅ Teste: resolvido por Ana Gestora às 14:05')
  })
})

describe('janela da própria OP não repete a ordem', () => {
  it('a frase da janela já diz "na OP", então não sai a linha', () => {
    const t = textoDoEnvio('alerta', { ...APROVACAO, janela_tipo: 'op', janela_valor: null })
    expect(t).toContain('na OP PMOG01/8504')
    expect(t).not.toContain('\nOP PMOG01/8504\n')
  })
})
