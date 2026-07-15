import { describe, it, expect } from 'vitest'
import { validarLinha, linhaMapaVazia, prepararLinhasImportacao } from '../validacao-linha'
import type { CampoImportavel } from '../mapeamento'

const campos = [
  { campo: 'numero_pedido', rotulo: 'Nº Pedido', tipo: 'texto', listaChave: null, obrigatorioImportacao: true },
  { campo: 'quantidade_pedido', rotulo: 'Qtd', tipo: 'numero', listaChave: null, obrigatorioImportacao: true },
] as const

describe('linhaMapaVazia', () => {
  it('true quando todos os campos estão vazios (null/branco)', () => {
    expect(linhaMapaVazia({ numero_pedido: null, quantidade_pedido: '  ' }, [...campos])).toBe(true)
  })
  it('false quando pelo menos um campo tem valor', () => {
    expect(linhaMapaVazia({ numero_pedido: '0654/26', quantidade_pedido: null }, [...campos])).toBe(false)
  })
})

describe('validarLinha', () => {
  it('erro quando obrigatório está vazio', () => {
    const r = validarLinha({ numero_pedido: '', quantidade_pedido: '10' }, [...campos], {})
    expect(r.erros.some((e) => e.campo === 'numero_pedido')).toBe(true)
  })
  it('erro quando número é inválido', () => {
    const r = validarLinha({ numero_pedido: '0654/26', quantidade_pedido: 'x' }, [...campos], {})
    expect(r.erros.some((e) => e.campo === 'quantidade_pedido')).toBe(true)
  })
  it('linha válida não tem erros e converte valores', () => {
    const r = validarLinha({ numero_pedido: '0654/26', quantidade_pedido: '10' }, [...campos], {})
    expect(r.erros).toEqual([])
    expect(r.valores.quantidade_pedido).toBe(10)
  })
})

describe('prepararLinhasImportacao', () => {
  const campos: CampoImportavel[] = [
    { campo: 'numero_nf', rotulo: 'NF', tipo: 'texto', listaChave: null, obrigatorioImportacao: false },
    { campo: 'data_chegada', rotulo: 'Data Chegada', tipo: 'data', listaChave: null, obrigatorioImportacao: false },
    { campo: 'numero_emb', rotulo: 'Nº EMB', tipo: 'texto', listaChave: null, obrigatorioImportacao: false },
  ]
  const base = {
    campos,
    mapeamento: { numero_nf: 'NF' },
    valoresFixos: { data_chegada: '2026-07-15', numero_emb: 'EMB341EA' },
    itensPorLista: {},
  }

  it('descarta linha em branco MESMO com valores fixos (não vira processo)', () => {
    const r = prepararLinhasImportacao({ ...base, linhasBrutas: [{ NF: '' }, { NF: '123' }] })
    expect(r.vazias).toBe(1)
    expect(r.validadas).toHaveLength(1)
  })

  it('aplica os valores fixos nas linhas válidas', () => {
    const r = prepararLinhasImportacao({ ...base, linhasBrutas: [{ NF: '123' }] })
    expect(r.validadas).toHaveLength(1)
    expect(r.validadas[0]!.valores.data_chegada).toBe('2026-07-15')
    expect(r.validadas[0]!.valores.numero_emb).toBe('EMB341EA')
    expect(r.validadas[0]!.erros).toEqual([])
  })

  it('ignora coluna mapeada para campo digitado — o valor fixo é a fonte', () => {
    const r = prepararLinhasImportacao({
      ...base,
      mapeamento: { numero_nf: 'NF', data_chegada: 'DataCol' },
      linhasBrutas: [{ NF: '123', DataCol: '01/01/2020' }],
    })
    expect(r.validadas).toHaveLength(1)
    expect(r.validadas[0]!.valores.data_chegada).toBe('2026-07-15')
  })

  it('valor fixo nulo vira null quando o campo é opcional', () => {
    const r = prepararLinhasImportacao({
      ...base,
      valoresFixos: { data_chegada: null, numero_emb: null },
      linhasBrutas: [{ NF: '123' }],
    })
    expect(r.validadas).toHaveLength(1)
    expect(r.validadas[0]!.valores.data_chegada).toBeNull()
    expect(r.validadas[0]!.erros).toEqual([])
  })
})
