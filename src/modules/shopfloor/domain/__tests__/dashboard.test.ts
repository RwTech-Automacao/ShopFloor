import { describe, it, expect } from 'vitest'
import { contarPorPosto, pivotarGrade } from '../dashboard'

const temStatus = (p: string) =>
  ['Inspeção SPI', 'Inspeção SMD', 'Inspeção PTH', 'Teste', 'Burn-in', 'Teste Final', 'Inspeção Final', 'Inspeção NQA'].some(
    (x) => x.toLowerCase() === p.toLowerCase(),
  )

describe('contarPorPosto', () => {
  const postos = ['Inicial', 'Teste', 'Embalagem']
  it('sem-status conta cada registro; com-status só aprovado; Manutenção incluída', () => {
    const r = contarPorPosto(postos, [
      { posto: 'Inicial', status: '' },
      { posto: 'Inicial', status: '' },
      { posto: 'Teste', status: 'Reprovado' },
      { posto: 'Teste', status: 'Aprovado' },
      { posto: 'Embalagem', status: '' },
      { posto: 'Manutenção', status: '' },
      { posto: 'Inspeção SMD', status: 'Aprovado' }, // fora do fluxo → ignora
    ], temStatus)
    expect(r).toEqual({ Inicial: 2, Teste: 1, Embalagem: 1, 'Manutenção': 1 })
  })
  it('zera postos sem registro', () => {
    expect(contarPorPosto(['Inicial'], [], temStatus)).toEqual({ Inicial: 0, 'Manutenção': 0 })
  })
})

describe('pivotarGrade', () => {
  const linha = (pmo: string, op: string, posto: string, ap = 0, rep = 0, pecas = 0) => ({
    pmo, op, cliente: 'VMI', descricao: 'Placa', qtdOp: 100, finalizada: false,
    posto, aprovados: ap, reprovados: rep, pecas,
  })

  it('junta as linhas da mesma OP numa linha só, com uma coluna por posto', () => {
    const g = pivotarGrade(
      [linha('PMOC14', '8498', 'Teste', 10, 2, 12), linha('PMOC14', '8498', 'Embalagem', 8, 0, 8)],
      ['Teste', 'Embalagem'],
    )
    expect(g.ops).toHaveLength(1)
    expect(g.ops[0]!.porPosto['Teste']).toEqual({ aprovados: 10, reprovados: 2, pecas: 12 })
    expect(g.ops[0]!.porPosto['Embalagem']).toEqual({ aprovados: 8, reprovados: 0, pecas: 8 })
  })

  it('as colunas seguem a ordem do fluxo, não a ordem em que os dados chegaram', () => {
    const g = pivotarGrade(
      [linha('P', '1', 'Embalagem'), linha('P', '1', 'Printer'), linha('P', '1', 'Teste')],
      ['Printer', 'Teste', 'Embalagem'],
    )
    expect(g.postos).toEqual(['Printer', 'Teste', 'Embalagem'])
  })

  it('posto fora do cadastro vai pro fim em vez de sumir — registro antigo continua visível', () => {
    const g = pivotarGrade(
      [linha('P', '1', 'Posto Antigo'), linha('P', '1', 'Teste')],
      ['Teste'],
    )
    expect(g.postos).toEqual(['Teste', 'Posto Antigo'])
  })

  it('OPs diferentes viram linhas diferentes', () => {
    const g = pivotarGrade([linha('A', '1', 'Teste'), linha('B', '2', 'Teste')], ['Teste'])
    expect(g.ops.map((o) => `${o.pmo}·${o.op}`)).toEqual(['A·1', 'B·2'])
  })

  it('OP sem nenhum posto ainda assim aparece — a linha existe, só vem vazia', () => {
    const g = pivotarGrade([linha('A', '1', '')], ['Teste'])
    expect(g.ops).toHaveLength(1)
    expect(g.postos).toEqual([])
  })
})
