import { describe, expect, it } from 'vitest'
import { RespostaInesperada } from '../leituras-erp'
import { saldoDisponivel, saldosPorEstoque } from '../saldo-por-estoque'

// Formato visto em 11/11/2026 (estoque/consultaSaldoItemEstoque, PMOC31: 5 estoques).
const linha = (item: string, estoque: string, saldo: number, descricao = `ESTOQUE ${estoque}`) => ({
  item: { codigo: item, descricao: 'X', unidade: { codigo: 'UN' } },
  estoque: { codigo: estoque, descricao, tipoPropriedadeEstoque: 0 },
  saldo,
})
const PMOC31 = {
  results: [
    linha('PMOC31', 'EA', 49), linha('PMOC31', 'EENG', 3), linha('PMOC31', 'SAT', 1),
    linha('PMOC31', 'Devol', 8), linha('PMOC31', 'PA', 14, 'PRODUTO ACABADO'),
  ],
  metadata: { resultset: { count: 5, offset: 0, limit: 50 } },
}

describe('saldosPorEstoque', () => {
  it('lê uma linha por estoque do item pedido', () => {
    const r = saldosPorEstoque(PMOC31, 'pmoc31')
    expect(r).toHaveLength(5)
    expect(r[4]).toEqual({ estoque: 'PA', descricao: 'PRODUTO ACABADO', saldo: 14 })
  })

  it('só aceita o código exato (PMOC5 não leva o saldo de PMOC57)', () => {
    const r = { results: [linha('PMOC57', 'PA', 100), linha('PMOC5', 'PA', 7)] }
    expect(saldosPorEstoque(r, 'PMOC5')).toEqual([{ estoque: 'PA', descricao: 'ESTOQUE PA', saldo: 7 }])
  })

  it('item sem saldo em nenhum estoque: lista vazia', () => {
    expect(saldosPorEstoque({ results: [], metadata: { resultset: { count: 0 } } }, 'PMOC52')).toEqual([])
  })

  it('formato inesperado vira RespostaInesperada (nunca zero inventado)', () => {
    expect(() => saldosPorEstoque({ nada: 1 }, 'X')).toThrow(RespostaInesperada)
    expect(() => saldosPorEstoque({ results: [{ item: { codigo: 'X' }, estoque: { codigo: 'PA' } }] }, 'X')).toThrow(RespostaInesperada)
    expect(() => saldosPorEstoque({ results: [{ item: { codigo: 'X' }, saldo: 1 }] }, 'X')).toThrow(RespostaInesperada)
  })
})

describe('saldoDisponivel', () => {
  it('soma só PA + EINTER (PMOC31: 76 em tudo, 14 disponível)', () => {
    expect(saldoDisponivel(saldosPorEstoque(PMOC31, 'PMOC31'))).toEqual({
      total: 14,
      porEstoque: [{ estoque: 'PA', saldo: 14 }, { estoque: 'EINTER', saldo: 0 }],
    })
  })

  it('PMOF52: tudo no intermediário conta', () => {
    const r = saldosPorEstoque({ results: [linha('PMOF52', 'EINTER', 961)] }, 'PMOF52')
    expect(saldoDisponivel(r).total).toBe(961)
  })

  it('código do estoque sem diferenciar maiúsculas', () => {
    expect(saldoDisponivel([{ estoque: 'pa', descricao: '', saldo: 2 }, { estoque: 'Einter', descricao: '', saldo: 3 }]).total).toBe(5)
  })
})
