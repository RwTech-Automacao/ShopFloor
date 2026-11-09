import { describe, expect, it } from 'vitest'
import type { DivergenciaDaEmb, RelatorioEmb } from '../emb-relatorio'
import { divergenciaNegativa, planilhaDivergencias, valorDaDivergencia } from '../emb-relatorio-excel'

const div = (parcial: Partial<DivergenciaDaEmb>): DivergenciaDaEmb => ({
  id: 'p1', numero: 1234, item: 'CAP-001', descricao: 'CAPACITOR', quantidadePedido: 500, quantidadeRecebida: 490,
  divergencia: '-10', justificativa: 'Falta no fornecedor', justificadaPorNome: 'Ana',
  justificadaEm: new Date('2026-11-06T16:00:00Z'), ...parcial,
})

const relatorio = (parcial: Partial<RelatorioEmb>): RelatorioEmb => ({
  emb: 'EMB392CA', processos: 2, pedidos: ['PO-1', 'PO-2'], fechada: true, fechadaEm: null, divergencias: [], ...parcial,
})

describe('valorDaDivergencia', () => {
  it('lê o texto do banco como número', () => {
    expect(valorDaDivergencia('-10')).toBe(-10)
    expect(valorDaDivergencia(' 5 ')).toBe(5)
    expect(valorDaDivergencia('-2,5')).toBe(-2.5)
  })
  it('vazio ou texto que não é número: null', () => {
    expect(valorDaDivergencia('')).toBeNull()
    expect(valorDaDivergencia('  ')).toBeNull()
    expect(valorDaDivergencia('abc')).toBeNull()
  })
})

describe('divergenciaNegativa', () => {
  it('só é negativa quando recebeu menos que o pedido', () => {
    expect(divergenciaNegativa('-10')).toBe(true)
    expect(divergenciaNegativa('-0,5')).toBe(true)
    expect(divergenciaNegativa('5')).toBe(false)
    expect(divergenciaNegativa('0')).toBe(false)
    expect(divergenciaNegativa('')).toBe(false)
    expect(divergenciaNegativa('abc')).toBe(false)
  })
})

describe('planilhaDivergencias', () => {
  it('monta identificação, cabeçalho e linhas com números de verdade', () => {
    const p = planilhaDivergencias(relatorio({
      divergencias: [
        div({}),
        div({
          id: null, numero: 1235, item: '', descricao: '', quantidadePedido: null, quantidadeRecebida: 3,
          divergencia: '3', justificativa: '  ', justificadaPorNome: 'Resto', justificadaEm: null,
        }),
        div({ numero: 1236, divergencia: '-2,5' }),
      ],
    }))
    expect(p.nomeArquivo).toBe('EMB392CA-divergencias.xlsx')
    expect(p.nomeAba).toBe('EMB392CA')
    expect(p.linhas).toEqual([
      ['EMB', 'EMB392CA'],
      ['Nº da PO', 'PO-1, PO-2'],
      [],
      ['Processo', 'Item', 'Descrição', 'Qtd pedido', 'Qtd recebida', 'Divergência', 'Justificativa', 'Justificado por'],
      [1234, 'CAP-001', 'CAPACITOR', 500, 490, -10, 'Falta no fornecedor', 'Ana'],
      [1235, '', '', null, 3, 3, '', ''],
      [1236, 'CAP-001', 'CAPACITOR', 500, 490, -2.5, 'Falta no fornecedor', 'Ana'],
    ])
  })

  it('divergência que não é número sai como texto; vazia sai vazia', () => {
    const p = planilhaDivergencias(relatorio({ divergencias: [div({ divergencia: 'n/d' }), div({ divergencia: '' })] }))
    expect(p.linhas[4]?.[5]).toBe('n/d')
    expect(p.linhas[5]?.[5]).toBeNull()
  })

  it('sem PO, a linha de identificação fica vazia', () => {
    expect(planilhaDivergencias(relatorio({ pedidos: [] })).linhas[1]).toEqual(['Nº da PO', ''])
  })

  it('troca caracteres proibidos no nome do arquivo e da aba, e corta a aba em 31', () => {
    const p = planilhaDivergencias(relatorio({ emb: 'EMB 1/2:A*[B]' + 'X'.repeat(40) }))
    expect(p.nomeArquivo).toBe(`EMB 1-2-A-[B]${'X'.repeat(40)}-divergencias.xlsx`)
    expect(p.nomeAba).toBe(`EMB 1-2-A--B-${'X'.repeat(40)}`.slice(0, 31))
    expect(p.nomeAba.length).toBe(31)
  })
})
