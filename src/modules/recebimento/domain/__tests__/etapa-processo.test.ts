import { describe, it, expect } from 'vitest'
import {
  etapaPorResultado,
  etapaPorStatus,
  formatarEspera,
  passagemDoEvento,
  rotuloPassagem,
  secaoDaDescricao,
  secaoDoDiff,
  situacaoAtual,
  temDivergencia,
  type EventoLog,
} from '../etapa-processo'

/** Log no formato que a trilha grava; cada teste sobrescreve só o que interessa. */
function evento(parcial: Partial<EventoLog>): EventoLog {
  return { acao: 'alterar_campo', descricao: '', gruposTocados: [], statusDe: null, statusPara: null, ...parcial }
}

describe('temDivergencia', () => {
  it('vazio é "não conferido", não divergência', () => {
    expect(temDivergencia('')).toBe(false)
    expect(temDivergencia('   ')).toBe(false)
    expect(temDivergencia(null)).toBe(false)
    expect(temDivergencia(undefined)).toBe(false)
  })
  it('zero é sem divergência', () => {
    expect(temDivergencia('0')).toBe(false)
    expect(temDivergencia(0)).toBe(false)
    expect(temDivergencia('0,00')).toBe(false)
  })
  it('qualquer outro número, positivo ou negativo, é divergência', () => {
    expect(temDivergencia('-10')).toBe(true)
    expect(temDivergencia('10')).toBe(true)
    expect(temDivergencia(-10)).toBe(true)
    expect(temDivergencia('-0,5')).toBe(true)
  })
  it('texto que não é número é sem divergência (não inventa significado)', () => {
    expect(temDivergencia('sem divergência')).toBe(false)
    expect(temDivergencia('N/A')).toBe(false)
  })
})

describe('etapaPorResultado', () => {
  it('Reprovado é a única saída lateral', () => {
    expect(etapaPorResultado('Reprovado')).toBe('reprovado')
    expect(etapaPorResultado('  reprovado ')).toBe('reprovado')
  })
  it('qualquer outro resultado conta como Almoxarifado, inclusive valor novo da lista', () => {
    expect(etapaPorResultado('Aprovado')).toBe('almoxarifado')
    expect(etapaPorResultado('Aprovado sob concessão')).toBe('almoxarifado')
    expect(etapaPorResultado('Aprovado com ressalva')).toBe('almoxarifado')
  })
})

describe('etapaPorStatus', () => {
  it('aberto espera conferência (Recebimento) e em_conferencia já é Qualidade', () => {
    expect(etapaPorStatus('aberto')).toBe('recebimento')
    expect(etapaPorStatus('em_conferencia')).toBe('qualidade')
  })
  it('status terminal vale o Resultado', () => {
    expect(etapaPorStatus('Aprovado')).toBe('almoxarifado')
    expect(etapaPorStatus('Reprovado')).toBe('reprovado')
  })
})

describe('secaoDoDiff', () => {
  it('deriva a seção pelo grupo dos campos alterados', () => {
    expect(secaoDoDiff(['comercial', 'recebimento'])).toBe('recebimento')
    expect(secaoDoDiff(['qualidade'])).toBe('qualidade')
  })
  it('diff que toca os dois grupos: Qualidade vence', () => {
    expect(secaoDoDiff(['recebimento', 'qualidade'])).toBe('qualidade')
    expect(secaoDoDiff(['qualidade', 'material', 'recebimento'])).toBe('qualidade')
  })
  it('não decide com diff vazio nem com diff só de campo base', () => {
    expect(secaoDoDiff([])).toBeNull()
    expect(secaoDoDiff(['comercial', 'material'])).toBeNull()
  })
})

describe('secaoDaDescricao', () => {
  it('lê a seção nomeada no texto do log', () => {
    expect(secaoDaDescricao('Processo #123 — seção recebimento salva')).toBe('recebimento')
    expect(secaoDaDescricao('Processo #123 — seção qualidade salva')).toBe('qualidade')
  })
  it('ignora descrição de outro evento', () => {
    expect(secaoDaDescricao('Processo #123 — foto anexada')).toBeNull()
    expect(secaoDaDescricao('')).toBeNull()
  })
})

describe('passagemDoEvento', () => {
  it('criação faz o item nascer no Recebimento', () => {
    expect(passagemDoEvento(evento({ acao: 'criar' }))).toEqual({
      tipo: 'criacao', de: null, para: 'recebimento', resultado: null,
    })
  })

  it('salvar a seção Recebimento passa o item para a Qualidade', () => {
    expect(passagemDoEvento(evento({ gruposTocados: ['recebimento'] }))).toEqual({
      tipo: 'avanco', de: 'recebimento', para: 'qualidade', resultado: null,
    })
  })

  it('salvar a seção Qualidade é trabalho dentro da caixa, não passagem', () => {
    expect(passagemDoEvento(evento({ gruposTocados: ['qualidade'] }))).toEqual({
      tipo: 'edicao', de: null, para: 'qualidade', resultado: null,
    })
  })

  it('diff vazio (salvar sem alterar nada) cai na seção nomeada na descrição', () => {
    // `calcularDiff` só devolve os campos que mudaram: salvar sem mexer em nada grava `dados: []`.
    expect(passagemDoEvento(evento({ descricao: 'Processo #7 — seção recebimento salva' }))).toEqual({
      tipo: 'avanco', de: 'recebimento', para: 'qualidade', resultado: null,
    })
  })

  it('o grupo do diff manda: a descrição é só o desempate', () => {
    expect(
      passagemDoEvento(evento({
        descricao: 'Processo #7 — seção qualidade salva',
        gruposTocados: ['recebimento'],
      })),
    ).toMatchObject({ tipo: 'avanco', de: 'recebimento' })
  })

  it('diff só de campo base, sem seção na descrição, não diz nada', () => {
    expect(passagemDoEvento(evento({ gruposTocados: ['comercial', 'material'] }))).toBeNull()
  })

  it('finalizar aprovado leva ao Almoxarifado e reprovado à saída lateral', () => {
    expect(passagemDoEvento(evento({
      acao: 'mudar_status', statusDe: 'em_conferencia', statusPara: 'Aprovado',
    }))).toEqual({ tipo: 'avanco', de: 'qualidade', para: 'almoxarifado', resultado: 'Aprovado' })
    expect(passagemDoEvento(evento({
      acao: 'mudar_status', statusDe: 'em_conferencia', statusPara: 'Reprovado',
    }))).toEqual({ tipo: 'avanco', de: 'qualidade', para: 'reprovado', resultado: 'Reprovado' })
  })

  it('reabrir traz o item de volta para a Qualidade', () => {
    expect(passagemDoEvento(evento({
      acao: 'mudar_status', statusDe: 'Aprovado', statusPara: 'em_conferencia',
    }))).toEqual({ tipo: 'reabertura', de: 'almoxarifado', para: 'qualidade', resultado: null })
  })

  it('a promoção automática do 1º salvamento não é passagem', () => {
    // Ela acontece junto com o log da seção, que já conta o movimento.
    expect(passagemDoEvento(evento({
      acao: 'mudar_status', statusDe: 'aberto', statusPara: 'em_conferencia',
    }))).toBeNull()
  })

  it('evento que não é do fluxo não vira passagem', () => {
    expect(passagemDoEvento(evento({ acao: 'excluir', descricao: 'foto removida' }))).toBeNull()
    expect(passagemDoEvento(evento({ acao: 'gerar_etiqueta' }))).toBeNull()
  })
})

describe('rotuloPassagem', () => {
  it('escreve o movimento como a tela mostra', () => {
    expect(rotuloPassagem({ tipo: 'criacao', de: null, para: 'recebimento', resultado: null })).toBe('→ Recebimento')
    expect(rotuloPassagem({ tipo: 'avanco', de: 'recebimento', para: 'qualidade', resultado: null }))
      .toBe('Recebimento → Qualidade')
    expect(rotuloPassagem({ tipo: 'avanco', de: 'qualidade', para: 'almoxarifado', resultado: 'Aprovado' }))
      .toBe('Qualidade → Almoxarifado (Aprovado)')
    expect(rotuloPassagem({ tipo: 'avanco', de: 'qualidade', para: 'reprovado', resultado: 'Reprovado' }))
      .toBe('Qualidade → Reprovado na Qualidade (Reprovado)')
    expect(rotuloPassagem({ tipo: 'reabertura', de: 'almoxarifado', para: 'qualidade', resultado: null }))
      .toBe('Almoxarifado → Qualidade (reaberto)')
    expect(rotuloPassagem({ tipo: 'edicao', de: null, para: 'qualidade', resultado: null })).toBe('Qualidade')
  })
})

describe('situacaoAtual', () => {
  const CRIADO = '2026-09-01T10:00:00Z'

  it('aberto está no Recebimento desde que nasceu', () => {
    expect(situacaoAtual({ status: 'aberto', criadoEm: CRIADO, finalizadoEm: null, eventos: [] }))
      .toEqual({ etapa: 'recebimento', desde: CRIADO })
  })

  it('processo sem histórico cai na caixa do status, com tempo desconhecido', () => {
    // Item criado antes de o módulo registrar log: a tela mostra "—" no tempo, não zero.
    expect(situacaoAtual({ status: 'em_conferencia', criadoEm: CRIADO, finalizadoEm: null, eventos: [] }))
      .toEqual({ etapa: 'qualidade', desde: null })
    expect(situacaoAtual({ status: 'Aprovado', criadoEm: CRIADO, finalizadoEm: null, eventos: [] }))
      .toEqual({ etapa: 'almoxarifado', desde: null })
  })

  it('vários salvamentos na Qualidade não reiniciam o relógio da caixa', () => {
    expect(situacaoAtual({
      status: 'em_conferencia', criadoEm: CRIADO, finalizadoEm: null,
      eventos: [
        { em: '2026-09-02T09:30:00Z', etapa: 'qualidade' }, // salvou o Recebimento: entrou aqui
        { em: '2026-09-04T14:06:00Z', etapa: 'qualidade' }, // mexeu na Qualidade
      ],
    })).toEqual({ etapa: 'qualidade', desde: '2026-09-02T09:30:00Z' })
  })

  it('reabertura reinicia o relógio (ela quebra a corrida)', () => {
    expect(situacaoAtual({
      status: 'em_conferencia', criadoEm: CRIADO, finalizadoEm: null,
      eventos: [
        { em: '2026-09-02T09:30:00Z', etapa: 'qualidade' },
        { em: '2026-09-05T14:06:00Z', etapa: 'almoxarifado' }, // finalizou
        { em: '2026-09-08T08:00:00Z', etapa: 'qualidade' }, // reabriu
      ],
    })).toEqual({ etapa: 'qualidade', desde: '2026-09-08T08:00:00Z' })
  })

  it('terminal usa a corrida do histórico e, na falta dela, finalizado_em', () => {
    expect(situacaoAtual({
      status: 'Reprovado', criadoEm: CRIADO, finalizadoEm: '2026-09-05T14:06:00Z',
      eventos: [{ em: '2026-09-05T14:06:00Z', etapa: 'reprovado' }],
    })).toEqual({ etapa: 'reprovado', desde: '2026-09-05T14:06:00Z' })
    expect(situacaoAtual({
      status: 'Aprovado', criadoEm: CRIADO, finalizadoEm: '2026-09-06T11:00:00Z', eventos: [],
    })).toEqual({ etapa: 'almoxarifado', desde: '2026-09-06T11:00:00Z' })
  })

  it('histórico que não fecha com o status não inventa tempo', () => {
    // Só a criação no histórico, mas o status diz em conferência: a caixa é do status, o tempo é "—".
    expect(situacaoAtual({
      status: 'em_conferencia', criadoEm: CRIADO, finalizadoEm: null,
      eventos: [{ em: CRIADO, etapa: 'recebimento' }],
    })).toEqual({ etapa: 'qualidade', desde: null })
  })
})

describe('formatarEspera', () => {
  it('tempo desconhecido vira travessão, não zero', () => {
    expect(formatarEspera(null)).toBe('—')
  })
  it('escreve em dia, hora e minuto', () => {
    expect(formatarEspera(0)).toBe('menos de 1 min')
    expect(formatarEspera(90)).toBe('1 min')
    expect(formatarEspera(3 * 3600)).toBe('3 h')
    expect(formatarEspera(3 * 3600 + 25 * 60)).toBe('3 h 25 min')
    expect(formatarEspera(2 * 86400)).toBe('2 d')
    expect(formatarEspera(2 * 86400 + 5 * 3600)).toBe('2 d 5 h')
  })
})
