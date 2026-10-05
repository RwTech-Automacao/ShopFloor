import { describe, it, expect } from 'vitest'
import { extrairLinhasSaldo } from '../ler-saldo-locacoes'

/**
 * Grade no formato que o SheetJS entrega (`header: 1`), imitando o export "Saldo por Locação" do
 * ERP: três linhas de preâmbulo antes do cabeçalho, a locação como faixa e colunas que a
 * etiquetagem ignora de propósito (saldo, unidade, peso...). Dados inventados.
 */
const GRADE: unknown[][] = [
  ['EMPRESA', 'FÁBRICA DE EXEMPLO LTDA - 00.000.000/0001-00', '', '', '', '', '', '', '', ''],
  ['FILTROS', '', '', '', '', '', '', '', '', ''],
  ['LOCAÇÃO', 'A1', '', '', '', '', '', '', '', ''],
  ['CÓDIGO ITEM', 'DESCRIÇÃO ITEM', 'LOCAÇÃO', 'LINHA', 'ESTOQUE', 'NEGOCIANTE', 'SALDO', 'UNIDADE', 'PESO', 'PESO TOTAL'],
  ['CAPA78', 'CAPACITOR DE EXEMPLO 1', 'A1.C.39 - A1.C.39', 'CAP - CAPACITORES', 'EP', '160 - EXEMPLO', 2473, 'PÇ - PEÇA', 0, 0],
  ['CAPF47', 'CAPACITOR DE EXEMPLO 2', 'A1.C37 - A1.C.37', 'CAP - CAPACITORES', 'EP', '160 - EXEMPLO', 1314, 'UN - UNIDADE', 0, 0],
  ['', 'ITEM SEM CÓDIGO', 'A1.C.01 - A1.C.01', 'CAP - CAPACITORES', 'EP', '160 - EXEMPLO', 5, 'PC - PEÇA', 0, 0],
  ['', '', '', '', '', '', '', '', '', ''],
  ['RESY99', 'RESISTOR DE EXEMPLO', 'A1.C.71 - A1.C.71', 'RES - RESISTORES', 'EP', '160 - EXEMPLO', 1968, 'UN - UNIDADE', 0, 0],
]

describe('extrairLinhasSaldo', () => {
  it('acha o cabeçalho depois do preâmbulo e lê só item, descrição e locação', () => {
    const { linhas, erro } = extrairLinhasSaldo(GRADE)
    expect(erro).toBeNull()
    expect(linhas).toEqual([
      { linhaPlanilha: 5, item: 'CAPA78', descricao: 'CAPACITOR DE EXEMPLO 1', locacao: 'A1.C.39 - A1.C.39' },
      { linhaPlanilha: 6, item: 'CAPF47', descricao: 'CAPACITOR DE EXEMPLO 2', locacao: 'A1.C37 - A1.C.37' },
      { linhaPlanilha: 7, item: '', descricao: 'ITEM SEM CÓDIGO', locacao: 'A1.C.01 - A1.C.01' },
      { linhaPlanilha: 9, item: 'RESY99', descricao: 'RESISTOR DE EXEMPLO', locacao: 'A1.C.71 - A1.C.71' },
    ])
  })

  it('a linha sem código SEGUE adiante: quem recusa e conta é o domínio, não o leitor', () => {
    const { linhas } = extrairLinhasSaldo(GRADE)
    expect(linhas.some((l) => l.item === '')).toBe(true)
  })

  it('linha totalmente vazia é descartada, e a numeração continua a do Excel', () => {
    const { linhas } = extrairLinhasSaldo(GRADE)
    expect(linhas.map((l) => l.linhaPlanilha)).toEqual([5, 6, 7, 9])
  })

  it('aceita cabeçalho sem acento e em caixa baixa', () => {
    const { linhas, erro } = extrairLinhasSaldo([
      ['codigo item', 'descricao item', 'locacao'],
      ['CAPA78', 'EXEMPLO', 'A1.C.39'],
    ])
    expect(erro).toBeNull()
    expect(linhas).toEqual([{ linhaPlanilha: 2, item: 'CAPA78', descricao: 'EXEMPLO', locacao: 'A1.C.39' }])
  })

  it('planilha que não é o export do ERP volta com erro, não com lista vazia em silêncio', () => {
    const { linhas, erro } = extrairLinhasSaldo([['QUALQUER', 'COISA'], ['a', 'b']])
    expect(linhas).toEqual([])
    expect(erro).toMatch(/Código Item/)
  })

  it('export sem a coluna de locação volta com erro', () => {
    const { erro } = extrairLinhasSaldo([['CÓDIGO ITEM', 'DESCRIÇÃO ITEM'], ['CAPA78', 'EXEMPLO']])
    expect(erro).toMatch(/Locação/)
  })

  it('export só com cabeçalho volta com erro', () => {
    const { erro } = extrairLinhasSaldo([['CÓDIGO ITEM', 'DESCRIÇÃO ITEM', 'LOCAÇÃO']])
    expect(erro).toMatch(/nenhuma linha/)
  })
})
