import { describe, expect, it } from 'vitest'
import { textoDoEnvio } from '../envio'

const dados = {
  regra_tipo: 'parado', regra_nome: 'Parado ou travado', posto: 'Teste',
  janela_tipo: 'op', janela_valor: null, pmo: 'TODAS', op: '—',
  ops: [{ pmo: 'TODAS', op: '—' }],
  aberta_em: '2026-10-28T17:00:00Z', agora: '2026-10-28T18:05:00Z',
  limite_horas: 168, mais_antiga_min: 12960, expediente: false,
  itens: [
    { pmo: 'PRT797', op: '8563', mais_antiga_min: 12960,
      itens: [{ tipo: 'posto', codigo: 'Teste', pecas: 3, minutos: 12960 }] },
    { pmo: 'PMOG13', op: '9001', mais_antiga_min: 11520,
      itens: [{ tipo: 'posto', codigo: 'Embalagem', pecas: 2, minutos: 11520 }] },
  ],
}

describe('textoDoEnvio — parado (relatório único)', () => {
  it('alerta: assunto com o total e o nº de OPs, uma linha por OP, rodapé', () => {
    expect(textoDoEnvio('alerta', dados).split('\n')).toEqual([
      '⏰ 5 peças paradas há mais de 7 dias em 2 OPs',
      'PRT797/8563 · 3 peças · mais antiga há 9d · Teste (3)',
      'PMOG13/9001 · 2 peças · mais antiga há 8d · Embalagem (2)',
      'Regra: Parado ou travado · 28/10 15:05',
    ])
  })

  it('lembrete tem o MESMO formato, com a lista de agora (segundo lembrete reflete a lista nova)', () => {
    expect(textoDoEnvio('lembrete', dados)).toBe(textoDoEnvio('alerta', dados))
    const depois = { ...dados, itens: [dados.itens[0]!] }
    const t = textoDoEnvio('lembrete', depois)
    expect(t.split('\n')[0]).toBe('⏰ 3 peças paradas há mais de 7 dias em 1 OP')
    expect(t).not.toContain('PMOG13')
  })

  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...dados, itens: [] })).toBe('🟢 Parado na produção: sem peças paradas')
  })

  it('reabertura envolve o texto com o cabeçalho de reabertura', () => {
    const t = textoDoEnvio('alerta', {
      ...dados, reabertura: true, resolvida_por_nome: 'Ana', resolvida_em: '2026-10-28T16:00:00Z',
    })
    expect(t).toMatch(/^🔁 Reaberto — dado como resolvido por Ana/)
  })

  it('expediente aparece no limite', () => {
    expect(textoDoEnvio('alerta', { ...dados, expediente: true }).split('\n')[0]).toContain('de expediente em 2 OPs')
  })

  it('300 OPs: nunca passa de 2000 caracteres', () => {
    const itens = Array.from({ length: 300 }, (_, i) => ({
      pmo: 'PRT797', op: String(8000 + i), mais_antiga_min: 20000 - i,
      itens: [{ tipo: 'posto', codigo: 'Teste', pecas: 1, minutos: 20000 - i }],
    }))
    const t = textoDoEnvio('alerta', { ...dados, itens })
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(t).toContain('… e mais')
    expect(t.endsWith('Regra: Parado ou travado · 28/10 15:05')).toBe(true)
  })

  it('item de tipo antigo (caixa/lote/peca) é dado inválido, não mensagem torta', () => {
    const ruim = [{ pmo: 'A', op: '1', mais_antiga_min: 1, itens: [{ tipo: 'caixa', codigo: 'CX', pecas: 1, minutos: 1 }] }]
    expect(() => textoDoEnvio('alerta', { ...dados, itens: ruim })).toThrow(/DADOS_INVALIDOS/)
  })

  it('itens que não são lista viram erro de dados, não mensagem vazia', () => {
    expect(() => textoDoEnvio('alerta', { ...dados, itens: 'x' })).toThrow(/DADOS_INVALIDOS/)
  })
})

describe('textoDoEnvio — parado com o link do relatório', () => {
  const comRegra = { ...dados, regra_id: 'r-123' }
  const opcoes = { urlBase: 'https://shopfloor.enterplak.com.br' }

  it('com regra_id e urlBase: a linha do link antes do rodapé, assunto igual', () => {
    expect(textoDoEnvio('alerta', comRegra, opcoes).split('\n')).toEqual([
      '⏰ 5 peças paradas há mais de 7 dias em 2 OPs',
      'PRT797/8563 · 3 peças · mais antiga há 9d · Teste (3)',
      'PMOG13/9001 · 2 peças · mais antiga há 8d · Embalagem (2)',
      'Ver relatório completo: https://shopfloor.enterplak.com.br/shopfloor/analisar/parados?regra=r-123',
      'Regra: Parado ou travado · 28/10 15:05',
    ])
  })

  it('o lembrete leva o mesmo link', () => {
    expect(textoDoEnvio('lembrete', comRegra, opcoes)).toBe(textoDoEnvio('alerta', comRegra, opcoes))
  })

  it('sem regra_id (linha antiga) ou sem urlBase: sai como antes, sem link', () => {
    expect(textoDoEnvio('alerta', dados, opcoes)).toBe(textoDoEnvio('alerta', dados))
    expect(textoDoEnvio('alerta', comRegra)).toBe(textoDoEnvio('alerta', dados))
    expect(textoDoEnvio('alerta', comRegra)).not.toContain('Ver relatório')
  })

  it('a normalização não muda', () => {
    expect(textoDoEnvio('normalizou', { ...comRegra, itens: [] }, opcoes)).toBe('🟢 Parado na produção: sem peças paradas')
  })
})
