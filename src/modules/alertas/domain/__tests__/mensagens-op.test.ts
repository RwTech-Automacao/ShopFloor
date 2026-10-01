import { describe, it, expect } from 'vitest'
import { textoDoEnvio } from '../envio'
import { LIMITE_MENSAGEM, rotulosOps, textoOp } from '../mensagens'

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

/**
 * `dados.ops` (0136): TODAS as OPs da janela, porque uma janela de 60 min pode atravessar várias e
 * escolher uma delas inventaria informação. Decisão do usuário em 01/10.
 */
const UMA = [{ pmo: 'PMOG01', op: '8504' }]
const DUAS = [{ pmo: 'PMOG01', op: '8504' }, { pmo: 'PMOG01', op: '8510' }]

describe('rotulosOps', () => {
  it('a lista vira texto na ordem que o banco deu', () => {
    expect(rotulosOps({ ops: DUAS })).toEqual(['PMOG01/8504', 'PMOG01/8510'])
  })
  it('repetida entra uma vez só', () => {
    expect(rotulosOps({ ops: [...UMA, ...UMA] })).toEqual(['PMOG01/8504'])
  })
  it('lista vazia cai no par escalar (linha antiga da fila, sem a 0136)', () => {
    expect(rotulosOps({ pmo: 'PMOG01', op: '8504', ops: [] })).toEqual(['PMOG01/8504'])
  })
  it('sem lista e sem par, nada', () => {
    expect(rotulosOps({})).toEqual([])
  })
  it('par sem OP dentro da lista é descartado', () => {
    expect(rotulosOps({ ops: [{ pmo: 'PMOG01', op: null }, ...UMA] })).toEqual(['PMOG01', 'PMOG01/8504'])
  })
})

describe('a lista de OPs na mensagem', () => {
  it('uma ordem: "OP" no singular', () => {
    expect(textoDoEnvio('alerta', { ...APROVACAO, pmo: null, op: null, ops: UMA })).toContain(
      '\nOP PMOG01/8504\n',
    )
  })
  it('duas ordens: "OPs" no plural, numa linha só', () => {
    expect(textoDoEnvio('alerta', { ...APROVACAO, pmo: null, op: null, ops: DUAS })).toContain(
      '\nOPs PMOG01/8504, PMOG01/8510\n',
    )
  })
  it('a lista manda; o par escalar é só reserva', () => {
    const t = textoDoEnvio('alerta', { ...APROVACAO, pmo: 'PMOX', op: '1', ops: DUAS })
    expect(t).toContain('\nOPs PMOG01/8504, PMOG01/8510\n')
    expect(t).not.toContain('PMOX/1')
  })
  it('sem a chave ops (fila antiga), vale o par escalar', () => {
    expect(textoDoEnvio('alerta', APROVACAO)).toContain('\nOP PMOG01/8504\n')
  })
  it('ops que não é array é ignorado', () => {
    expect(textoDoEnvio('alerta', { ...APROVACAO, ops: 'PMOG01/8504' })).toContain('\nOP PMOG01/8504\n')
  })
  it('item que não é objeto é descartado', () => {
    expect(
      textoDoEnvio('alerta', { ...APROVACAO, pmo: null, op: null, ops: ['PMOG01/8504', null, ...UMA] }),
    ).toContain('\nOP PMOG01/8504\n')
  })
  it('normalizou leva a lista no sufixo', () => {
    expect(textoDoEnvio('normalizou', { ...TEMPO, pmo: null, op: null, ops: DUAS })).toBe(
      '🟢 Teste normalizou: 3:00 por peça · OPs PMOG01/8504, PMOG01/8510',
    )
  })
  it('defeito leva a lista, e as posições vêm depois', () => {
    const t = textoDoEnvio('alerta', { ...DEFEITO, pmo: null, op: null, ops: DUAS, posicoes: ['R12'] })
    expect(t).toContain('\nOPs PMOG01/8504, PMOG01/8510\nPosição: R12\n')
  })
  it('resolvido leva a lista', () => {
    expect(
      textoDoEnvio('resolvido', {
        posto: 'Teste',
        resolvida_por_nome: 'Ana Gestora',
        resolvida_em: '2026-09-17T17:05:00+00:00',
        ops: DUAS,
      }),
    ).toBe('✅ Teste: resolvido por Ana Gestora às 14:05 · OPs PMOG01/8504, PMOG01/8510')
  })
  it('janela da própria OP continua sem a linha, mesmo com a lista', () => {
    const t = textoDoEnvio('alerta', { ...APROVACAO, janela_tipo: 'op', janela_valor: null, ops: UMA })
    expect(t).toContain('na OP PMOG01/8504')
    expect(t).not.toContain('\nOP PMOG01/8504\n')
  })
})

describe('lista de OPs comprida não vira paredão nem estoura o limite', () => {
  const MUITAS = Array.from({ length: 200 }, (_, i) => ({ pmo: 'PMOG01', op: String(9000 + i) }))

  it('corta dizendo quantas ficaram de fora', () => {
    const t = textoDoEnvio('alerta', { ...APROVACAO, pmo: null, op: null, ops: MUITAS })
    const linha = t.split('\n').find((l) => l.startsWith('OPs '))!
    const m = /… e mais (\d+) OPs$/.exec(linha)
    expect(m).not.toBeNull()
    const mostradas = linha.slice('OPs '.length).split(', ').length - 1
    expect(mostradas + Number(m![1])).toBe(MUITAS.length)
  })
  it('o alerta inteiro continua cabendo no limite', () => {
    const t = textoDoEnvio('alerta', { ...APROVACAO, pmo: null, op: null, ops: MUITAS })
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
  })
  it('com a lista comprida E muitas posições, o defeito ainda cabe', () => {
    const t = textoDoEnvio('alerta', {
      ...DEFEITO,
      pmo: null,
      op: null,
      ops: MUITAS,
      posicoes: Array.from({ length: 400 }, (_, i) => `R${i + 1}`),
    })
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
    expect(t).toContain('Posições: ')
  })
})
