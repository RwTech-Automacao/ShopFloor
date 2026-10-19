import { describe, expect, it } from 'vitest'
import { RespostaInesperada } from '../leituras-erp'
import { saldoDoItem } from '../saldo-item'

// Formato visto em 16/10/2026 (itemMovimento/findFilter, item PRT446: 28 em estoque próprio).
const linha = (codigo: string, extra: Record<string, unknown> = {}) => ({
  item: { codigo, descricao: ` ${codigo} DESCRICAO `, unidade: { codigo: 'UN' } },
  saldoItemEstoqueProprio: 0,
  saldoItemPendencia: 0,
  saldoItemEstoqueEmTerceiros: 0,
  saldoItemEstoqueDeTerceiros: 0,
  ...extra,
})

describe('saldoDoItem', () => {
  it('lê o saldo próprio e os demais do item pedido', () => {
    const r = { data: [linha('PRT446', { saldoItemEstoqueProprio: 28 })] }
    expect(saldoDoItem(r, 'prt446')).toEqual({
      codigo: 'PRT446',
      descricao: 'PRT446 DESCRICAO',
      unidade: 'UN',
      proprio: 28,
      pendencia: 0,
      emTerceiros: 0,
      deTerceiros: 0,
    })
  })

  it('só aceita o código exato (PMOC5 não pode devolver o saldo de PMOC57)', () => {
    const r = { data: [linha('PMOC57', { saldoItemEstoqueProprio: 149 }), linha('PMOC5', { saldoItemEstoqueProprio: 7 })] }
    expect(saldoDoItem(r, 'PMOC5')?.proprio).toBe(7)
    expect(saldoDoItem({ data: [linha('PMOC57')] }, 'PMOC5')).toBeNull()
  })

  it('item que não veio na resposta é null, não zero', () => {
    expect(saldoDoItem({ data: [] }, 'PMOC99')).toBeNull()
  })

  it('campo de saldo ausente vira RespostaInesperada', () => {
    const r = { data: [{ item: { codigo: 'PMOC57', unidade: { codigo: 'UN' } }, saldoItemPendencia: 0 }] }
    expect(() => saldoDoItem(r, 'PMOC57')).toThrow(RespostaInesperada)
  })

  it('linha sem item.codigo vira RespostaInesperada', () => {
    expect(() => saldoDoItem({ data: [{ saldoItemEstoqueProprio: 1 }] }, 'X')).toThrow(RespostaInesperada)
  })
})
