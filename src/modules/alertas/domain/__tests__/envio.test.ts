import { describe, it, expect } from 'vitest'
import { DadosEnvioInvalidos, lerEnvioReservado, textoDoEnvio } from '../envio'

/** Os `dados` exatamente como o alerta_avaliar grava (jsonb_build_object da 0113). */
const DADOS = {
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
  aberta_em: '2026-09-17T16:35:00+00:00',
  agora: '2026-09-17T17:05:00+00:00',
}

describe('textoDoEnvio', () => {
  it('alerta', () => {
    expect(textoDoEnvio('alerta', DADOS)).toBe(
      '🔴 Teste abaixo da meta\n' +
        'Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados\n' +
        'Regra: Teste abaixo de 90 · 17/09 14:05',
    )
  })
  it('lembrete usa o tempo desde a abertura', () => {
    expect(textoDoEnvio('lembrete', DADOS)).toMatch(/^⏰ Lembrete — continua abaixo há 30 min\n🔴 Teste abaixo da meta/)
  })
  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...DADOS, aprovados: 95, reprovados: 5 })).toBe(
      '🟢 Teste normalizou: 95,0% (ficou 30 min abaixo)',
    )
  })
  it('janela op com a OP guardada', () => {
    const t = textoDoEnvio('alerta', { ...DADOS, janela_tipo: 'op', janela_valor: null, pmo: 'PMOB', op: '2002' })
    expect(t).toContain('na OP PMOB/2002')
  })
  it('resolvido', () => {
    expect(
      textoDoEnvio('resolvido', {
        posto: 'Teste',
        resolvida_por_nome: 'Bruno Líder',
        resolvida_em: '2026-09-17T17:05:00+00:00',
      }),
    ).toBe('✅ Teste: resolvido por Bruno Líder às 14:05')
  })
  it('teste', () => {
    expect(textoDoEnvio('teste', { nome: 'Ana' })).toContain('Ana')
  })
  it('dados incompletos lançam DadosEnvioInvalidos (quem chama trata por item)', () => {
    expect(() => textoDoEnvio('alerta', { ...DADOS, agora: 'não é data' })).toThrow(DadosEnvioInvalidos)
    expect(() => textoDoEnvio('alerta', { ...DADOS, janela_tipo: 'semana' })).toThrow(/janela_tipo/)
    expect(() => textoDoEnvio('normalizou', { ...DADOS, aprovados: null })).toThrow(/aprovados/)
    expect(() => textoDoEnvio('resolvido', { posto: 'Teste' })).toThrow(DadosEnvioInvalidos)
  })
  it('o mesmo dado gera o mesmo texto (reenvio idêntico)', () => {
    expect(textoDoEnvio('alerta', DADOS)).toBe(textoDoEnvio('alerta', structuredClone(DADOS)))
  })
})

describe('lerEnvioReservado', () => {
  const LINHA = {
    id: 'e1',
    ocorrencia_id: 'oc1',
    usuario_id: 'u1',
    canal: 'telegram',
    externo_id: '111',
    tipo: 'alerta',
    dados: DADOS,
    com_botao: true,
    tentativas: 1,
  }
  it('converte a linha do alerta_reservar_envios', () => {
    expect(lerEnvioReservado(LINHA)).toEqual({
      id: 'e1',
      ocorrenciaId: 'oc1',
      usuarioId: 'u1',
      canal: 'telegram',
      externoId: '111',
      tipo: 'alerta',
      dados: DADOS,
      comBotao: true,
      tentativas: 1,
    })
  })
  it('canal, tipo ou destino desconhecidos voltam null', () => {
    expect(lerEnvioReservado({ ...LINHA, canal: 'whatsapp' })).toBeNull()
    expect(lerEnvioReservado({ ...LINHA, tipo: 'coisa-nova' })).toBeNull()
    expect(lerEnvioReservado({ ...LINHA, externo_id: '' })).toBeNull()
    expect(lerEnvioReservado(null)).toBeNull()
  })
  it('ocorrência nula e dados ausentes', () => {
    const r = lerEnvioReservado({ ...LINHA, ocorrencia_id: null, dados: null })
    expect(r?.ocorrenciaId).toBeNull()
    expect(r?.dados).toEqual({})
  })
})
