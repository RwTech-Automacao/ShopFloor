import { describe, expect, it } from 'vitest'
import { lerRelatorioEmb, semJustificativa } from '../emb-relatorio'

const OK = {
  ok: true,
  emb: 'EMB388CA',
  processos: 21,
  pedidos: ['PO-1', '', 'PO-2'],
  fechada: true,
  fechada_em: '2026-11-06T17:00:00+00:00',
  divergencias: [
    {
      id: 'p1', numero: 1234, item: 'CAP-001', descricao: 'CAPACITOR', quantidade_pedido: 500, quantidade_recebida: 490,
      divergencia: '-10', justificativa: 'Falta no fornecedor', justificada_por_nome: 'Ana', justificada_em: '2026-11-06T16:00:00Z',
    },
    {
      id: null, numero: 1235, item: '', descricao: '', quantidade_pedido: null, quantidade_recebida: 3,
      divergencia: '3', justificativa: '', justificada_por_nome: '', justificada_em: null,
    },
    'lixo',
    { numero: 'x' },
  ],
}

describe('lerRelatorioEmb', () => {
  it('lê o jsonb da rec_emb_relatorio', () => {
    const r = lerRelatorioEmb(OK)
    expect(r).toEqual({
      ok: true,
      valor: {
        emb: 'EMB388CA', processos: 21, pedidos: ['PO-1', 'PO-2'], fechada: true,
        fechadaEm: new Date('2026-11-06T17:00:00Z'),
        divergencias: [
          {
            id: 'p1', numero: 1234, item: 'CAP-001', descricao: 'CAPACITOR', quantidadePedido: 500, quantidadeRecebida: 490,
            divergencia: '-10', justificativa: 'Falta no fornecedor', justificadaPorNome: 'Ana',
            justificadaEm: new Date('2026-11-06T16:00:00Z'),
          },
          {
            id: null, numero: 1235, item: '', descricao: '', quantidadePedido: null, quantidadeRecebida: 3,
            divergencia: '3', justificativa: '', justificadaPorNome: '', justificadaEm: null,
          },
        ],
      },
    })
  })

  it('EMB aberta: fechada_em nulo', () => {
    const r = lerRelatorioEmb({ ...OK, fechada: false, fechada_em: null, divergencias: [] })
    expect(r.ok && r.valor.fechada).toBe(false)
    expect(r.ok && r.valor.fechadaEm).toBeNull()
  })

  it('EMB inexistente e resposta estranha', () => {
    expect(lerRelatorioEmb({ ok: false, motivo: 'emb_inexistente' })).toEqual({ ok: false, motivo: 'emb_inexistente' })
    expect(lerRelatorioEmb(null)).toEqual({ ok: false, motivo: 'resposta_ilegivel' })
    expect(lerRelatorioEmb({ ok: true, emb: 'X' })).toEqual({ ok: false, motivo: 'resposta_ilegivel' })
  })
})

describe('semJustificativa', () => {
  it('conta as vazias (só espaço também)', () => {
    const r = lerRelatorioEmb(OK)
    if (!r.ok) throw new Error('esperava ok')
    expect(semJustificativa(r.valor.divergencias)).toBe(1)
    expect(semJustificativa([{ ...r.valor.divergencias[0]!, justificativa: '  ' }])).toBe(1)
  })
})
