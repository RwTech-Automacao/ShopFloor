import { describe, expect, it } from 'vitest'
import {
  lerValor, ordenarOs, osSugerida, voltaParaFabrica, rotuloStatus, validarMudancaNf, validarNota,
  type NotaInput, type RelogioInput,
} from '../entrada'

const relogio = (r: Partial<RelogioInput> = {}): RelogioInput => ({
  ns: '00043005620019177', produto: 'PMOC31', itensJunto: [], itensJuntoOutros: '', locacao: '', ...r,
})

const nota: NotaInput = {
  cnpj: '12345678000190', empresa: ' Cliente Fictício Ltda ', negocianteCodigo: 'C001', numero: ' 4521 ', valor: '',
  situacao: 'aprovada', motivos: [], relogios: [relogio()],
}

describe('validarNota', () => {
  it('aprovada: CNPJ com máscara, valor lido e cada NS normalizado em modelo + sequência', () => {
    const r = validarNota({
      ...nota, valor: 'R$ 1.500,50',
      relogios: [relogio({ itensJunto: ['bobina', 'chave', 'bobina'], locacao: ' prateleira 2 ' }), relogio({ ns: '562-19178' })],
    })
    expect(r).toEqual({ ok: true, valor: {
      cnpj: '12.345.678/0001-90', empresa: 'Cliente Fictício Ltda', negocianteCodigo: 'C001', numero: '4521',
      valor: 1500.5, situacao: 'aprovada', motivos: [],
      relogios: [
        { ns: '00043005620019177', modelo: '562', sequencia: '19177', produto: 'PMOC31', itensJunto: ['bobina', 'chave'],
          itensJuntoOutros: '', locacao: 'prateleira 2' },
        { ns: '562-19178', modelo: '562', sequencia: '19178', produto: 'PMOC31', itensJunto: [], itensJuntoOutros: '', locacao: '' },
      ],
    } })
  })

  it('aceita CPF (11 dígitos); código de negociante vazio vira null', () => {
    expect(validarNota({ ...nota, cnpj: '123.456.789-09', negocianteCodigo: ' ' }))
      .toMatchObject({ ok: true, valor: { cnpj: '123.456.789-09', negocianteCodigo: null } })
  })

  it('erros na ordem: CNPJ, número, valor, motivo, relógios', () => {
    const tudoErrado: NotaInput = { ...nota, cnpj: '123', numero: '', valor: 'abc', situacao: 'reprovada', motivos: [], relogios: [] }
    expect(validarNota(tudoErrado)).toEqual({ ok: false, erro: 'Informe o CNPJ da nota (14 dígitos) ou o CPF (11).' })
    expect(validarNota({ ...tudoErrado, cnpj: nota.cnpj })).toEqual({ ok: false, erro: 'Informe o número da NF.' })
    expect(validarNota({ ...tudoErrado, cnpj: nota.cnpj, numero: '1' })).toEqual({ ok: false, erro: 'Valor da nota inválido.' })
    expect(validarNota({ ...tudoErrado, cnpj: nota.cnpj, numero: '1', valor: '' }))
      .toEqual({ ok: false, erro: 'NF reprovada: escolha ao menos um motivo.' })
    expect(validarNota({ ...tudoErrado, cnpj: nota.cnpj, numero: '1', valor: '', motivos: ['m1'] }))
      .toEqual({ ok: false, erro: 'Bipe ao menos um relógio.' })
  })

  it('valor negativo recusa; reprovada leva os motivos (sem repetir); aprovada não leva motivo', () => {
    expect(validarNota({ ...nota, valor: '-3' })).toEqual({ ok: false, erro: 'Valor da nota inválido.' })
    expect(validarNota({ ...nota, situacao: 'reprovada', motivos: ['m1', 'm1', 'm2'] })).toMatchObject({ ok: true, valor: { motivos: ['m1', 'm2'] } })
    expect(validarNota({ ...nota, motivos: ['m1'] })).toMatchObject({ ok: true, valor: { motivos: [] } })
    expect(validarNota({ ...nota, situacao: 'talvez' as never })).toMatchObject({ ok: false })
  })

  it('o mesmo relógio duas vezes (mesmo modelo + sequência, escrito diferente) recusa', () => {
    expect(validarNota({ ...nota, relogios: [relogio(), relogio({ ns: '562-19177' })] }))
      .toEqual({ ok: false, erro: 'O número de série 562-19177 está duas vezes nesta nota.' })
  })

  it('sem sequência legível: repetido é o mesmo texto (sem diferenciar maiúsculas)', () => {
    expect(validarNota({ ...nota, relogios: [relogio({ ns: 'sem etiqueta' }), relogio({ ns: ' SEM ETIQUETA ' })] }))
      .toEqual({ ok: false, erro: 'O número de série SEM ETIQUETA está duas vezes nesta nota.' })
    expect(validarNota({ ...nota, relogios: [relogio({ ns: 'sem etiqueta' }), relogio({ ns: 'outra etiqueta' })] }))
      .toMatchObject({ ok: true, valor: { relogios: [{ modelo: null, sequencia: null }, { modelo: null, sequencia: null }] } })
  })

  it('relógio sem NS recusa', () => {
    expect(validarNota({ ...nota, relogios: [relogio({ ns: '  ' })] })).toEqual({ ok: false, erro: 'Informe o número de série.' })
  })

  it('"outros" exige o texto (diz qual relógio); item fora da lista recusa', () => {
    expect(validarNota({ ...nota, relogios: [relogio({ ns: '562-1', itensJunto: ['outros'] })] }))
      .toEqual({ ok: false, erro: 'Descreva os outros itens que vieram junto (562-1).' })
    expect(validarNota({ ...nota, relogios: [relogio({ itensJunto: ['outros'], itensJuntoOutros: ' suporte ' })] }))
      .toMatchObject({ ok: true, valor: { relogios: [{ itensJuntoOutros: 'suporte' }] } })
    expect(validarNota({ ...nota, relogios: [relogio({ itensJunto: ['mesa' as never] })] }))
      .toEqual({ ok: false, erro: 'Item que veio junto inválido.' })
  })

  it('texto de "outros" sem o item marcado é descartado', () => {
    expect(validarNota({ ...nota, relogios: [relogio({ itensJuntoOutros: 'suporte' })] }))
      .toMatchObject({ ok: true, valor: { relogios: [{ itensJuntoOutros: '' }] } })
  })
})

describe('validarMudancaNf', () => {
  it('corrigir: reprovada exige motivo; aprovada zera os motivos', () => {
    expect(validarMudancaNf({ tipo: 'corrigir', situacao: 'reprovada', motivos: [] })).toEqual({ ok: false, erro: 'NF reprovada: escolha ao menos um motivo.' })
    expect(validarMudancaNf({ tipo: 'corrigir', situacao: 'aprovada', motivos: ['x'] })).toEqual({ ok: true, motivos: [] })
  })

  const troca = {
    tipo: 'troca' as const, numero: '2', cnpj: '12345678000190', empresa: 'C', negocianteCodigo: null, valor: '10,5',
    situacao: 'aprovada' as const, motivos: [],
  }
  it('troca: CNPJ, número e valor da nota nova', () => {
    expect(validarMudancaNf({ ...troca, cnpj: '1' })).toEqual({ ok: false, erro: 'Informe o CNPJ da nota (14 dígitos) ou o CPF (11).' })
    expect(validarMudancaNf({ ...troca, numero: ' ' })).toEqual({ ok: false, erro: 'Informe o número da NF nova.' })
    expect(validarMudancaNf({ ...troca, valor: 'x' })).toEqual({ ok: false, erro: 'Valor da nota inválido.' })
    expect(validarMudancaNf({ ...troca, situacao: 'reprovada' })).toEqual({ ok: false, erro: 'NF reprovada: escolha ao menos um motivo.' })
    expect(validarMudancaNf(troca)).toEqual({ ok: true, motivos: [], cnpj: '12.345.678/0001-90', valor: 10.5 })
    expect(validarMudancaNf({ ...troca, valor: '' })).toMatchObject({ ok: true, valor: null })
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
  const nenhuma = new Set<string>()
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
    expect(osSugerida(os, nenhuma)?.id).toBe('d')
    expect(osSugerida(os.filter((o) => o.id !== 'd'), nenhuma)?.id).toBe('a')
    expect(osSugerida(os.filter((o) => o.id === 'b' || o.id === 'c'), nenhuma)).toBeNull()
    expect(osSugerida([], nenhuma)).toBeNull()
  })
  it('pula a OS que já está ligada a outra entrada', () => {
    expect(osSugerida(os, new Set(['d']))?.id).toBe('a')
    expect(osSugerida(os, new Set(['d', 'a']))).toBeNull()
  })
})

describe('rotuloStatus', () => {
  it('v1: recebido com a NF aprovada ou reprovada', () => {
    expect(rotuloStatus('aprovada')).toBe('Recebido – NF aprovada')
    expect(rotuloStatus('reprovada')).toBe('Recebido – NF reprovada')
  })
})
