import { describe, it, expect } from 'vitest'
import { lerResolucao } from '../resolucao'

describe('lerResolucao', () => {
  it('converte o jsonb do alerta_resolver', () => {
    const r = lerResolucao({
      ocorrencia_id: 'oc1',
      regra_id: 'r1',
      posto: 'Teste',
      ja_resolvida: false,
      resolvida_por: 'u2',
      resolvida_por_nome: 'Bruno Líder',
      resolvida_em: '2026-09-17T17:05:00+00:00',
    })
    expect(r.ocorrenciaId).toBe('oc1')
    expect(r.regraId).toBe('r1')
    expect(r.posto).toBe('Teste')
    expect(r.jaResolvida).toBe(false)
    expect(r.resolvidaPorId).toBe('u2')
    expect(r.resolvidaPorNome).toBe('Bruno Líder')
    expect(r.resolvidaEm.toISOString()).toBe('2026-09-17T17:05:00.000Z')
  })

  it('idempotente: ja_resolvida true', () => {
    expect(lerResolucao({ ja_resolvida: true }).jaResolvida).toBe(true)
  })

  it('sem data usa o agora (nunca devolve Invalid Date)', () => {
    const r = lerResolucao({ ocorrencia_id: 'oc1' })
    expect(Number.isNaN(r.resolvidaEm.getTime())).toBe(false)
  })
})
