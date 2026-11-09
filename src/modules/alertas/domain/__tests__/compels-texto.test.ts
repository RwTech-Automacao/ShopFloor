import { describe, expect, it } from 'vitest'
import { LIMITE_MENSAGEM } from '../mensagens'
import { textoAlertaCompels, textoAvisosCompels, textoNormalizouCompels } from '../compels-texto'

const AGORA = new Date('2026-11-06T18:05:00Z') // 15:05 em São Paulo
const base = { regraNome: 'Compels Valdei', pmo: 'PRT797', op: '8682_F', em: AGORA }

describe('textoAlertaCompels', () => {
  it('diz a OP, quantas linhas e leva o texto que o Compels devolveu', () => {
    const t = textoAlertaCompels({
      ...base,
      linhas: 3,
      itens: [{ motivo: 'Aguardando requisição no Compels: falta empenho do componente 123', linhas: 3, pecas: 48, desistiu: false }],
    })
    const [primeira] = t.split('\n')
    // A primeira linha é o assunto do e-mail: tem que dizer a OP sozinha.
    expect(primeira).toContain('OP PRT797/8682_F')
    expect(primeira).toContain('3 linhas')
    expect(t).toContain('• Aguardando requisição no Compels: falta empenho do componente 123 · 3 linhas · 48 peças')
    expect(t).toContain('Regra: Compels Valdei · 06/11 15:05')
  })

  it('singular e a marca de que parou de tentar', () => {
    const t = textoAlertaCompels({
      ...base,
      linhas: 1,
      itens: [{ motivo: 'ERP fora do ar', linhas: 1, pecas: 1, desistiu: true }],
    })
    expect(t.split('\n')[0]).toContain('1 linha')
    expect(t.split('\n')[0]).not.toContain('1 linhas')
    expect(t).toContain('• ERP fora do ar · 1 linha · 1 peça · parou de tentar')
  })

  it('motivo gigante é aparado e a mensagem cabe no Discord', () => {
    const itens = Array.from({ length: 40 }, (_, i) => ({
      motivo: `motivo ${i} ${'x'.repeat(400)}`, linhas: 2, pecas: 4, desistiu: false,
    }))
    const t = textoAlertaCompels({ ...base, linhas: 80, itens })
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM - 160) // sobra a margem do lembrete/reabertura
    expect(t).toMatch(/… e mais \d+ motivos/)
    expect(t).toContain('Regra: Compels Valdei')
  })
})

describe('textoNormalizouCompels', () => {
  it('diz que a OP não tem mais problema', () => {
    expect(textoNormalizouCompels({ pmo: 'PRT797', op: '8682_F' })).toBe(
      '🟢 Compels: OP PRT797/8682_F sem problemas no envio',
    )
  })
})

describe('textoAvisosCompels', () => {
  it('lista OP, peças e o aviso gravado', () => {
    const t = textoAvisosCompels('Compels Valdei', AGORA, [
      { pmo: 'PRT797', op: '8682_F', quantidade: 160, aviso: 'quantidade inesperada no Compels: apontado 40, esperado 30' },
      { pmo: 'PRT798', op: '8700', quantidade: 1, aviso: 'empenho insuficiente' },
    ])
    const linhas = t.split('\n')
    expect(linhas[0]).toContain('2 entradas')
    expect(linhas[0]).toContain('com ressalva')
    expect(t).toContain('• OP PRT797/8682_F · 160 peças — quantidade inesperada no Compels: apontado 40, esperado 30')
    expect(t).toContain('• OP PRT798/8700 · 1 peça — empenho insuficiente')
    expect(t).toContain('Regra: Compels Valdei · 06/11 15:05')
  })

  it('uma entrada só, no singular', () => {
    const t = textoAvisosCompels('R', AGORA, [{ pmo: 'P', op: '1', quantidade: 2, aviso: 'a' }])
    expect(t.split('\n')[0]).toContain('1 entrada gravada com ressalva')
  })

  it('muitos avisos: corta com "… e mais N avisos" dentro do limite', () => {
    const avisos = Array.from({ length: 60 }, (_, i) => ({
      pmo: 'PMO', op: String(i), quantidade: 1, aviso: 'y'.repeat(300),
    }))
    const t = textoAvisosCompels('R', AGORA, avisos)
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
    expect(t).toMatch(/… e mais \d+ avisos/)
  })
})
