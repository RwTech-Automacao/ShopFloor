import { describe, it, expect } from 'vitest'
import { lerResultadoAvaliacao, textoDaAcao, acaoTemBotao, type AcaoAvaliacao } from '../avaliacao'
import { ehRotaPublicaDeAlertas } from '../rotas'

const JSON_RPC = {
  ocupado: false,
  avaliadas: 3,
  acoes: [
    {
      ocorrencia_id: '11111111-2222-3333-4444-555555555555',
      tipo: 'alerta',
      regra_id: '99999999-2222-3333-4444-555555555555',
      regra_nome: 'Teste abaixo de 90',
      posto: 'Teste',
      taxa: 75.0,
      taxa_minima: 90.0,
      aprovados: 15,
      reprovados: 5,
      janela_tipo: 'tempo',
      janela_valor: 60,
      pmo: null,
      op: null,
      aberta_em: '2026-09-17T17:05:00+00:00',
      agora: '2026-09-17T17:05:00+00:00',
      contas: [
        { usuario_id: 'u1', canal: 'telegram', externo_id: '111' },
        { usuario_id: 'u1', canal: 'whatsapp', externo_id: '111' },
        { usuario_id: 'u2', canal: 'discord', externo_id: '' },
      ],
    },
    { tipo: 'coisa-nova', posto: 'X' },
  ],
}

describe('lerResultadoAvaliacao', () => {
  it('lê o resumo e converte a ação', () => {
    const r = lerResultadoAvaliacao(JSON_RPC)
    expect(r.ocupado).toBe(false)
    expect(r.avaliadas).toBe(3)
    expect(r.acoes).toHaveLength(1)
    const a = r.acoes[0]!
    expect(a.ocorrenciaId).toBe('11111111-2222-3333-4444-555555555555')
    expect(a.tipo).toBe('alerta')
    expect(a.regraNome).toBe('Teste abaixo de 90')
    expect(a.taxa).toBe(75)
    expect(a.janelaTipo).toBe('tempo')
    expect(a.janelaValor).toBe(60)
    expect(a.pmo).toBeNull()
  })
  it('descarta canal desconhecido e conta sem id externo', () => {
    const a = lerResultadoAvaliacao(JSON_RPC).acoes[0]!
    expect(a.contas).toEqual([{ usuarioId: 'u1', canal: 'telegram', externoId: '111' }])
  })
  it('ocupado devolve lista vazia', () => {
    expect(lerResultadoAvaliacao({ ocupado: true, avaliadas: 0, acoes: [] })).toEqual({
      ocupado: true,
      avaliadas: 0,
      acoes: [],
    })
  })
  it('entrada inesperada não explode', () => {
    expect(lerResultadoAvaliacao(null)).toEqual({ ocupado: false, avaliadas: 0, acoes: [] })
  })
})

const BASE: AcaoAvaliacao = {
  ocorrenciaId: 'oc1',
  tipo: 'alerta',
  regraId: 'r1',
  regraNome: 'Teste abaixo de 90',
  posto: 'Teste',
  taxa: 75,
  taxaMinima: 90,
  aprovados: 15,
  reprovados: 5,
  janelaTipo: 'tempo',
  janelaValor: 60,
  pmo: null,
  op: null,
  abertaEm: '2026-09-17T16:35:00Z',
  agora: '2026-09-17T17:05:00Z',
  contas: [],
}

describe('textoDaAcao', () => {
  it('alerta', () => {
    expect(textoDaAcao(BASE).startsWith('🔴 Teste abaixo da meta')).toBe(true)
  })
  it('lembrete usa o tempo desde a abertura', () => {
    expect(textoDaAcao({ ...BASE, tipo: 'lembrete' })).toContain('⏰ Lembrete — continua abaixo há 30 min')
  })
  it('normalizou', () => {
    const t = textoDaAcao({ ...BASE, tipo: 'normalizou', aprovados: 95, reprovados: 5 })
    expect(t).toBe('🟢 Teste normalizou: 95,0% (ficou 30 min abaixo)')
  })
})

describe('acaoTemBotao', () => {
  it('alerta e lembrete levam botão; normalizou não', () => {
    expect(acaoTemBotao(BASE)).toBe(true)
    expect(acaoTemBotao({ ...BASE, tipo: 'lembrete' })).toBe(true)
    expect(acaoTemBotao({ ...BASE, tipo: 'normalizou' })).toBe(false)
  })
})

describe('ehRotaPublicaDeAlertas', () => {
  it('as rotas de alertas passam sem sessão', () => {
    expect(ehRotaPublicaDeAlertas('/api/alertas/avaliar')).toBe(true)
    expect(ehRotaPublicaDeAlertas('/api/alertas/telegram')).toBe(true)
    expect(ehRotaPublicaDeAlertas('/api/alertas/discord')).toBe(true)
  })
  it('o resto continua passando pela sessão', () => {
    expect(ehRotaPublicaDeAlertas('/shopfloor/operar')).toBe(false)
    expect(ehRotaPublicaDeAlertas('/api/anexos/x')).toBe(false)
    expect(ehRotaPublicaDeAlertas('/api/alertasfalso')).toBe(false)
  })
})
