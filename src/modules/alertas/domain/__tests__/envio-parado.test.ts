import { describe, expect, it } from 'vitest'
import { textoDoEnvio } from '../envio'

const dados = {
  regra_tipo: 'parado', regra_nome: 'Parado no Almox', posto: 'ALMOX',
  janela_tipo: 'op', janela_valor: null, pmo: 'PRT797', op: '8563',
  ops: [{ pmo: 'PRT797', op: '8563' }],
  aberta_em: '2026-10-28T17:00:00Z', agora: '2026-10-28T18:05:00Z',
  limite_horas: 2, mais_antiga_min: 190,
  itens: [{ tipo: 'caixa', codigo: 'CX[3][500]', pecas: 500, minutos: 190 }],
}

describe('textoDoEnvio — parado', () => {
  it('alerta', () => {
    const t = textoDoEnvio('alerta', dados)
    expect(t).toContain('OP PRT797/8563')
    expect(t).toContain('• CX[3][500] · 500 placas · 3 h 10 min')
  })

  it('lembrete leva o cabeçalho de lembrete', () => {
    expect(textoDoEnvio('lembrete', dados)).toMatch(/^⏰ Lembrete — continua há \d+ min\n/)
  })

  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...dados, itens: [] })).toBe(
      '🟢 Almoxarifado: OP PRT797/8563 sem itens parados',
    )
  })

  it('reabertura envolve o texto com o cabeçalho de reabertura', () => {
    const t = textoDoEnvio('alerta', {
      ...dados, reabertura: true, resolvida_por_nome: 'Ana', resolvida_em: '2026-10-28T16:00:00Z',
    })
    expect(t).toMatch(/^🔁 Reaberto — dado como resolvido por Ana/)
  })

  it('itens que não são lista viram erro de dados, não mensagem vazia', () => {
    expect(() => textoDoEnvio('alerta', { ...dados, itens: 'x' })).toThrow(/DADOS_INVALIDOS/)
  })
})
