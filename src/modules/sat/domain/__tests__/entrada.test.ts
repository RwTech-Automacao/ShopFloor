import { describe, expect, it } from 'vitest'
import {
  cnpjDoCliente, lerValor, ordenarOs, osSugerida, voltaParaFabrica, rotuloStatus, validarEntrada, validarMudancaNf,
  type EntradaInput,
} from '../entrada'

const valida: EntradaInput = {
  ns: '00043005620019177', osId: null, empresa: 'Cliente A', cnpj: '', produto: 'REP X', nf: '4521', valor: '',
  frete: null, itensJunto: [], itensJuntoOutros: '', defeito: '', locacao: '', custo: '', situacao: 'aprovada',
  motivos: [],
}

describe('validarEntrada', () => {
  it('aprovada: normaliza o NS em modelo + sequência e lê os valores', () => {
    const r = validarEntrada({ ...valida, valor: 'R$ 1.500,50', custo: '0', frete: 'pago', itensJunto: ['bobina', 'chave'] })
    expect(r).toEqual({ ok: true, valor: expect.objectContaining({
      ns: '00043005620019177', modelo: '562', sequencia: '19177', valor: 1500.5, custo: 0, frete: 'pago',
      itensJunto: ['bobina', 'chave'], motivos: [],
    }) })
  })

  it('NS e NF obrigatórios', () => {
    expect(validarEntrada({ ...valida, ns: '  ' })).toEqual({ ok: false, erro: 'Informe o número de série.' })
    expect(validarEntrada({ ...valida, nf: ' ' })).toEqual({ ok: false, erro: 'Informe a NF de entrada.' })
  })

  it('reprovada exige 1+ motivo; aprovada não leva motivo', () => {
    expect(validarEntrada({ ...valida, situacao: 'reprovada' })).toEqual({ ok: false, erro: 'NF reprovada: escolha ao menos um motivo.' })
    expect(validarEntrada({ ...valida, situacao: 'reprovada', motivos: ['m1'] })).toMatchObject({ ok: true })
    expect(validarEntrada({ ...valida, motivos: ['m1'] })).toMatchObject({ ok: true, valor: { motivos: [] } })
  })

  it('valor e custo: número ≥ 0 ou vazio', () => {
    expect(validarEntrada({ ...valida, valor: '-3' })).toEqual({ ok: false, erro: 'Valor unitário inválido.' })
    expect(validarEntrada({ ...valida, custo: 'abc' })).toEqual({ ok: false, erro: 'Custo inválido.' })
    expect(validarEntrada({ ...valida, valor: '' })).toMatchObject({ ok: true, valor: { valor: null } })
  })

  it('"outros" nos itens que vieram junto exige o texto; item fora da lista recusa', () => {
    expect(validarEntrada({ ...valida, itensJunto: ['outros'] })).toEqual({ ok: false, erro: 'Descreva os outros itens que vieram junto.' })
    expect(validarEntrada({ ...valida, itensJunto: ['outros'], itensJuntoOutros: 'suporte' })).toMatchObject({ ok: true })
    expect(validarEntrada({ ...valida, itensJunto: ['mesa' as never] })).toMatchObject({ ok: false })
  })

  it('situação e frete fora da lista recusam', () => {
    expect(validarEntrada({ ...valida, situacao: 'talvez' as never })).toMatchObject({ ok: false })
    expect(validarEntrada({ ...valida, frete: 'fob' as never })).toMatchObject({ ok: false })
  })

  it('NS ilegível ainda grava (sem par)', () => {
    expect(validarEntrada({ ...valida, ns: 'sem etiqueta' })).toMatchObject({ ok: true, valor: { modelo: null, sequencia: null } })
  })
})

describe('validarMudancaNf', () => {
  it('troca exige a nota nova; reprovada exige motivo', () => {
    expect(validarMudancaNf({ tipo: 'troca', nf: '', situacao: 'aprovada', motivos: [] })).toEqual({ ok: false, erro: 'Informe a NF nova.' })
    expect(validarMudancaNf({ tipo: 'corrigir', situacao: 'reprovada', motivos: [] })).toEqual({ ok: false, erro: 'NF reprovada: escolha ao menos um motivo.' })
    expect(validarMudancaNf({ tipo: 'corrigir', situacao: 'aprovada', motivos: ['x'] })).toEqual({ ok: true, motivos: [] })
  })
})

describe('lerValor', () => {
  it('aceita vírgula ou ponto decimal e separador de milhar', () => {
    expect(lerValor('1.234,56')).toBe(1234.56)
    expect(lerValor('1234.56')).toBe(1234.56)
    expect(lerValor('R$ 10')).toBe(10)
    expect(lerValor('')).toBeNull()
    expect(lerValor('1,2,3')).toBeNaN()
  })
})

describe('ordenarOs / osSugerida / voltaParaFabrica', () => {
  const os = [
    { id: 'a', numero: '1', data: '2026-01-01', solucao: 'Envio ao SAT' },
    { id: 'b', numero: '2', data: '2026-03-01', solucao: 'Envio de Peça para o Cliente' },
    { id: 'c', numero: '3', data: null, solucao: '' },
    { id: 'd', numero: '4', data: '2026-02-01', solucao: 'Troca do Relógio' },
  ]
  it('mais recente primeiro (sem data no fim)', () => {
    expect(ordenarOs(os).map((o) => o.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('só "Envio ao SAT" e "Troca do Relógio" voltam para a fábrica', () => {
    expect(voltaParaFabrica('Envio ao SAT')).toBe(true)
    expect(voltaParaFabrica('  envio ao sat ')).toBe(true)
    expect(voltaParaFabrica('Troca do Relógio')).toBe(true)
    expect(voltaParaFabrica('TROCA DO RELOGIO')).toBe(true)
    for (const s of ['Envio de Peça para o Cliente', 'Manutenção do display no cliente', 'Envio de Rep para o Cliente',
      'Manutenção', 'Devolução', 'Remanufatura', '', '8432']) expect(voltaParaFabrica(s)).toBe(false)
  })
  it('sugere a última que volta para a fábrica; nenhuma volta = nenhuma sugerida', () => {
    expect(osSugerida(os)?.id).toBe('d')
    expect(osSugerida(os.filter((o) => o.id !== 'd'))?.id).toBe('a')
    expect(osSugerida(os.filter((o) => o.id === 'b' || o.id === 'c'))).toBeNull()
    expect(osSugerida([])).toBeNull()
  })
})

describe('cnpjDoCliente', () => {
  it('separa o CNPJ do nome', () => {
    expect(cnpjDoCliente('Cliente Fictício Ltda - 12.345.678/0001-90')).toEqual({ nome: 'Cliente Fictício Ltda', cnpj: '12.345.678/0001-90' })
    expect(cnpjDoCliente('Cliente B CNPJ: 12345678000190')).toEqual({ nome: 'Cliente B', cnpj: '12.345.678/0001-90' })
    expect(cnpjDoCliente('Só o nome')).toEqual({ nome: 'Só o nome', cnpj: '' })
  })
})

describe('rotuloStatus', () => {
  it('v1: recebido com a NF aprovada ou reprovada', () => {
    expect(rotuloStatus('aprovada')).toBe('Recebido – NF aprovada')
    expect(rotuloStatus('reprovada')).toBe('Recebido – NF reprovada')
  })
})
