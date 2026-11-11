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

describe('validarOrdem com várias faixas', () => {
  const F1 = { sn_ini: '0845801001', sn_fim: '0845801993' }
  const F2 = { sn_ini: '08458001024', sn_fim: '08458001030' }
  const multi = { ...base, faixas: [F1, F2] }

  it('a soma das faixas tem que bater EXATAMENTE com a quantidade (caso 8682_F: 993 + 7 = 1000)', () => {
    expect(validarOrdem({ ...multi, qtd: 1000 })).toEqual({ ok: true })
    expect(validarOrdem({ ...multi, qtd: 993 })).toEqual({
      ok: false,
      erro: 'A quantidade (993) não bate com as faixas de Nº de Série (1000 números). Confira as faixas e a quantidade.',
    })
  })
  it('a lista manda: snIni/snFim são ignorados quando há faixas', () => {
    expect(validarOrdem({ ...multi, snIni: '', snFim: '', qtd: 1000 }).ok).toBe(true)
  })
  it('placas por painel multiplica o total das faixas', () => {
    expect(validarOrdem({ ...multi, qtd: 2000, placasPorPainel: 2 }).ok).toBe(true)
  })
  it('faixa vazia ou incoerente é apontada pelo número', () => {
    expect(validarOrdem({ ...base, faixas: [F1, { sn_ini: '', sn_fim: '' }] })).toEqual({
      ok: false,
      erro: 'Preencha o início e o fim da faixa 2 de SN.',
    })
    expect(validarOrdem({ ...base, faixas: [F1, { sn_ini: '9', sn_fim: '1' }] })).toEqual({
      ok: false,
      erro: 'Faixa 2 de SN inválida: início e fim devem ter o mesmo formato, e o início não pode ser maior que o fim.',
    })
  })
  it('faixas que se sobrepõem são recusadas', () => {
    expect(
      validarOrdem({ ...base, faixas: [{ sn_ini: '1', sn_fim: '10' }, { sn_ini: '20', sn_fim: '30' }, { sn_ini: '5', sn_fim: '6' }] }),
    ).toEqual({ ok: false, erro: 'As faixas 1 e 3 de SN se sobrepõem.' })
  })
  it('lista vazia → pede a faixa', () => {
    expect(validarOrdem({ ...base, faixas: [] })).toEqual({ ok: false, erro: 'Preencha o início e o fim da faixa de SN.' })
  })
  it('uma faixa só na lista: mesmas mensagens de sempre', () => {
    expect(validarOrdem({ ...base, faixas: [{ sn_ini: 'SN0001', sn_fim: 'SN0500' }], qtd: 499 })).toEqual({
      ok: false,
      erro: 'A quantidade (499) não bate com a faixa de Nº de Série (500 números). Confira o SN inicial/final e a quantidade.',
    })
  })
})
