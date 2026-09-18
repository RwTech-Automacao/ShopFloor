import { describe, it, expect } from 'vitest'
import {
  formatarDataHoraCurta, formatarHora, formatarDuracao,
  textoAlerta, textoLembrete, textoResolvido, textoNormalizou, textoTeste, textoVinculado,
  TEXTO_INSTRUCOES_TELEGRAM,
} from '../mensagens'

// 17/09/2026 14:05 em São Paulo (UTC-3, sem horário de verão desde 2019).
const EM = new Date('2026-09-17T17:05:00Z')

describe('formatação de data e hora (fuso de São Paulo)', () => {
  it('data e hora curtas', () => {
    expect(formatarDataHoraCurta(EM)).toBe('17/09 14:05')
  })
  it('só a hora', () => {
    expect(formatarHora(EM)).toBe('14:05')
  })
})

describe('formatarDuracao', () => {
  it('menos de 1 minuto', () => {
    expect(formatarDuracao(30_000)).toBe('menos de 1 min')
  })
  it('minutos', () => {
    expect(formatarDuracao(35 * 60_000)).toBe('35 min')
  })
  it('horas redondas', () => {
    expect(formatarDuracao(2 * 60 * 60_000)).toBe('2 h')
  })
  it('horas e minutos', () => {
    expect(formatarDuracao(80 * 60_000)).toBe('1 h 20 min')
  })
})

const DADOS = {
  posto: 'Teste',
  regraNome: 'Teste abaixo de 90',
  taxaMinima: 90,
  aprovados: 15,
  reprovados: 5,
  janela: { tipo: 'tempo' as const, valor: 60, pmo: null, op: null },
  em: EM,
}

describe('textoAlerta', () => {
  it('monta as três linhas do alerta', () => {
    expect(textoAlerta(DADOS)).toBe(
      '🔴 Teste abaixo da meta\n' +
        'Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados\n' +
        'Regra: Teste abaixo de 90 · 17/09 14:05',
    )
  })
  it('usa o texto da janela de OP quando é o caso', () => {
    const t = textoAlerta({ ...DADOS, janela: { tipo: 'op', valor: null, pmo: 'PMOA', op: '1001' } })
    expect(t).toContain('na OP PMOA/1001')
  })
})

describe('textoLembrete', () => {
  it('acrescenta o cabeçalho com o tempo desde a abertura', () => {
    const t = textoLembrete({ ...DADOS, abertaEm: new Date('2026-09-17T16:35:00Z') })
    expect(t.split('\n')[0]).toBe('⏰ Lembrete — continua abaixo há 30 min')
    expect(t).toContain('🔴 Teste abaixo da meta')
    expect(t).toContain('Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados')
  })
})

describe('textoResolvido', () => {
  it('diz quem resolveu e quando', () => {
    expect(textoResolvido({ posto: 'Teste', nome: 'Ana Gestora', em: EM })).toBe(
      '✅ Teste: resolvido por Ana Gestora às 14:05',
    )
  })
})

describe('textoNormalizou', () => {
  it('mostra a taxa que normalizou e quanto tempo ficou abaixo', () => {
    expect(
      textoNormalizou({
        posto: 'Teste',
        aprovados: 95,
        reprovados: 5,
        abertaEm: new Date('2026-09-17T15:45:00Z'),
        em: EM,
      }),
    ).toBe('🟢 Teste normalizou: 95,0% (ficou 1 h 20 min abaixo)')
  })
})

describe('textos de vínculo', () => {
  it('teste nomeia quem pediu', () => {
    expect(textoTeste('Ana Gestora')).toContain('Ana Gestora')
  })
  it('confirmação de vínculo', () => {
    expect(textoVinculado('Ana Gestora')).toBe('✅ Conta vinculada ao ShopFloor (Ana Gestora)')
  })
  it('instruções citam Meu perfil e o formato do código', () => {
    expect(TEXTO_INSTRUCOES_TELEGRAM).toContain('Meu perfil')
    expect(TEXTO_INSTRUCOES_TELEGRAM).toContain('ALERTA-')
  })
})
