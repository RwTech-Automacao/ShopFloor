import { describe, expect, it } from 'vitest'
import { textoDoEnvio } from '../envio'

const dados = {
  regra_tipo: 'parado', regra_nome: 'Parado ou travado', posto: 'Teste',
  janela_tipo: 'op', janela_valor: null, pmo: 'PRT797', op: '8563',
  ops: [{ pmo: 'PRT797', op: '8563' }],
  aberta_em: '2026-10-28T17:00:00Z', agora: '2026-10-28T18:05:00Z',
  limite_horas: 168, mais_antiga_min: 12960, expediente: false,
  itens: [{ tipo: 'posto', codigo: 'Teste', pecas: 3, minutos: 12960, amostras: ['258001', '258002'] }],
}

describe('textoDoEnvio — parado', () => {
  it('alerta', () => {
    const t = textoDoEnvio('alerta', dados)
    expect(t).toContain('OP PRT797/8563')
    expect(t).toContain('• Teste · 3 peças · a mais antiga há 9 d · ex.: 258001, 258002')
    expect(t.split('\n')[0]).toBe('⚠️ Parado na produção: OP PRT797/8563 com 3 peças paradas (limite 168 h)')
  })

  it('lembrete leva a OP no assunto (primeira linha) e há quanto tempo o alerta está aberto', () => {
    expect(textoDoEnvio('lembrete', dados)).toMatch(/^⏰ Lembrete — OP PRT797\/8563 · aberto há 1 h 05 min\n⚠️ Parado na produção/)
    const tresDias = { ...dados, aberta_em: '2026-10-25T18:05:00Z' }
    expect(textoDoEnvio('lembrete', tresDias).split('\n')[0]).toBe('⏰ Lembrete — OP PRT797/8563 · aberto há 3 d')
  })

  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...dados, itens: [] })).toBe(
      '🟢 Parado na produção: OP PRT797/8563 sem peças paradas',
    )
  })

  it('reabertura envolve o texto com o cabeçalho de reabertura', () => {
    const t = textoDoEnvio('alerta', {
      ...dados, reabertura: true, resolvida_por_nome: 'Ana', resolvida_em: '2026-10-28T16:00:00Z',
    })
    expect(t).toMatch(/^🔁 Reaberto — dado como resolvido por Ana/)
  })

  it('expediente aparece no limite', () => {
    expect(textoDoEnvio('alerta', { ...dados, expediente: true }).split('\n')[0]).toContain('(limite 168 h de expediente)')
  })

  it('item de tipo antigo (caixa/lote/peca) é dado inválido, não mensagem torta', () => {
    expect(() => textoDoEnvio('alerta', { ...dados, itens: [{ tipo: 'caixa', codigo: 'CX', pecas: 1, minutos: 1 }] }))
      .toThrow(/DADOS_INVALIDOS/)
  })

  it('itens que não são lista viram erro de dados, não mensagem vazia', () => {
    expect(() => textoDoEnvio('alerta', { ...dados, itens: 'x' })).toThrow(/DADOS_INVALIDOS/)
  })
})
