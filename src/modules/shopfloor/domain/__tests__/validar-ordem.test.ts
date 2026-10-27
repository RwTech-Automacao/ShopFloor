import { describe, it, expect } from 'vitest'
import { validarOrdem } from '../validar-ordem'

const base = { pmo: 'PMOF1', op: '100', cliente: 'Empresa 1', snIni: 'SN0001', snFim: 'SN0500', qtd: null }

describe('validarOrdem', () => {
  it('aceita OP válida (pmo, op, cliente, faixa)', () => {
    expect(validarOrdem(base).ok).toBe(true)
  })
  it('exige pmo, op e cliente', () => {
    expect(validarOrdem({ ...base, pmo: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, op: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, cliente: '  ' }).ok).toBe(false)
  })
  it('faixa de SN obrigatória: ambos vazios ou só um → erro', () => {
    expect(validarOrdem({ ...base, snIni: '', snFim: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, snIni: 'SN0001', snFim: '' }).ok).toBe(false)
    expect(validarOrdem({ ...base, snIni: '', snFim: 'SN0500' }).ok).toBe(false)
  })
  it('faixa incoerente → erro', () => {
    expect(validarOrdem({ ...base, snIni: 'SN0500', snFim: 'SN0001' }).ok).toBe(false) // início > fim
    expect(validarOrdem({ ...base, snIni: 'SN0001', snFim: 'XX0500' }).ok).toBe(false) // prefixos diferentes
  })
  it('faixa de 1 peça (início == fim) → ok', () => {
    expect(validarOrdem({ ...base, snIni: 'SN0001', snFim: 'SN0001' }).ok).toBe(true)
  })
  it('quantidade × faixa: bate → ok; diverge → erro; qtd nula → não checa', () => {
    expect(validarOrdem({ ...base, qtd: 500 }).ok).toBe(true) // SN0001..SN0500 = 500
    expect(validarOrdem({ ...base, qtd: 499 }).ok).toBe(false) // diverge
    expect(validarOrdem({ ...base, snIni: 'SN0001', snFim: 'SN0001', qtd: 5 }).ok).toBe(false) // faixa 1 ≠ 5
    expect(validarOrdem({ ...base, qtd: null }).ok).toBe(true) // sem qtd, não checa
  })

  it('placas por painel: recusa não inteiro ou menor que 1', () => {
    const msg = 'Placas por painel deve ser um número inteiro maior ou igual a 1.'
    expect(validarOrdem({ ...base, placasPorPainel: 0 })).toEqual({ ok: false, erro: msg })
    expect(validarOrdem({ ...base, placasPorPainel: 1.5 })).toEqual({ ok: false, erro: msg })
    expect(validarOrdem({ ...base, placasPorPainel: -2 })).toEqual({ ok: false, erro: msg })
    expect(validarOrdem({ ...base, placasPorPainel: 50 }).ok).toBe(true)
    expect(validarOrdem({ ...base, placasPorPainel: 1 }).ok).toBe(true)
  })
  it('placas por painel: a faixa de SN conta painéis, então qtd (em placas) = faixa × N', () => {
    // SN0001..SN0500 = 500 painéis × 50 = 25000 placas
    expect(validarOrdem({ ...base, placasPorPainel: 50, qtd: 25000 }).ok).toBe(true)
    expect(validarOrdem({ ...base, placasPorPainel: 50, qtd: 500 }).ok).toBe(false)
  })
})
