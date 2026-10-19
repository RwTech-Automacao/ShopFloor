import { describe, it, expect } from 'vitest'
import { textoDoEnvio } from '../envio'

const DADOS = {
  regra_tipo: 'emb',
  regra_nome: 'Fim de EMB',
  emb: 'EMB390',
  fechada_em: '2026-10-09T14:00:00Z',
  agora: '2026-10-09T14:05:00Z',
  divergencias: [
    {
      numero: 1234,
      item: 'CAP-001',
      descricao: 'CAPACITOR 100UF',
      quantidade_pedido: 500,
      quantidade_recebida: 490,
      divergencia: '-10',
      justificativa: 'Fornecedor avisou falta.',
      justificada_por_nome: 'Ana Gestora',
    },
    {
      numero: 1235,
      item: 'RES-002',
      descricao: 'RESISTOR 1K',
      quantidade_pedido: 100,
      quantidade_recebida: 105,
      divergencia: '5',
      justificativa: '',
      justificada_por_nome: '',
    },
  ],
}

describe('textoDoEnvio com tipo emb', () => {
  it('monta a mensagem a partir do dados que a 0150 grava', () => {
    const t = textoDoEnvio('emb', DADOS)
    expect(t).toContain('EMB390')
    expect(t).toContain('CAP-001')
    expect(t).toContain('Fornecedor avisou falta.')
    expect(t).toContain('sem justificativa')
  })

  it('aceita quantidade nula (campo em branco no Recebimento)', () => {
    const t = textoDoEnvio('emb', {
      ...DADOS,
      divergencias: [{ ...DADOS.divergencias[0], quantidade_pedido: null }],
    })
    expect(t).toContain('pedido —')
  })

  /**
   * ⚠️ Item e descrição VAZIOS são dado legítimo, não corrompido: `rec_emb_divergencias` faz
   * `coalesce(codigo_material, '')` e `coalesce(descricao_material, '')`, e a EMB390 de produção
   * tinha 120 itens sem `codigo_material`. Um leitor que exigisse texto não-vazio aqui derrubaria
   * a mensagem inteira dessa EMB.
   */
  it('aceita item e descrição vazios (campo livre do Recebimento)', () => {
    const t = textoDoEnvio('emb', {
      ...DADOS,
      divergencias: [{ ...DADOS.divergencias[0], item: '', descricao: '' }],
    })
    expect(t).toContain('#1234')
    expect(t).toContain('pedido 500')
  })

  it('lança quando `divergencias` não é lista (dado corrompido)', () => {
    expect(() => textoDoEnvio('emb', { ...DADOS, divergencias: 'nada' })).toThrow()
  })

  it('lança quando `emb` falta — nunca manda uma mensagem sem dizer de que EMB é', () => {
    const { emb: _emb, ...semEmb } = DADOS
    expect(() => textoDoEnvio('emb', semEmb)).toThrow()
  })

  it('lança quando um item da lista não é objeto', () => {
    expect(() => textoDoEnvio('emb', { ...DADOS, divergencias: ['x'] })).toThrow()
  })
})
