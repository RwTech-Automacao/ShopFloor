import { describe, it, expect } from 'vitest'
import { contarPorPosto, pivotarGrade } from '../dashboard'

const temStatus = (p: string) =>
  ['Inspeção SPI', 'Inspeção SMD', 'Inspeção PTH', 'Teste', 'Burn-in', 'Teste Final', 'Inspeção Final', 'Inspeção NQA'].some(
    (x) => x.toLowerCase() === p.toLowerCase(),
  )

describe('contarPorPosto', () => {
  const postos = ['Inicial', 'Teste', 'Embalagem']
  it('conta PEÇAS: sem-status e Manutenção contam quem passou; com-status só quem aprovou', () => {
    const r = contarPorPosto(postos, [
      { posto: 'Inicial', status: '', sn: 'a' },
      { posto: 'Inicial', status: '', sn: 'b' },
      { posto: 'Teste', status: 'Reprovado', sn: 'a' },
      { posto: 'Teste', status: 'Aprovado', sn: 'b' },
      { posto: 'Embalagem', status: '', sn: 'b' },
      { posto: 'Manutenção', status: '', sn: 'a' },
      { posto: 'Inspeção SMD', status: 'Aprovado', sn: 'a' }, // fora do fluxo → ignora
    ], temStatus)
    expect(r).toEqual({ Inicial: 2, Teste: 1, Embalagem: 1, 'Manutenção': 1 })
  })

  it('a mesma peça bipada várias vezes no posto conta uma — reparo com dois consertos não infla a Manutenção', () => {
    const r = contarPorPosto(['Teste'], [
      { posto: 'Teste', status: 'Reprovado', sn: 'a' },
      { posto: 'Manutenção', status: '', sn: 'a' },
      { posto: 'Manutenção', status: '', sn: 'a' },
      { posto: 'Manutenção', status: '', sn: 'a' },
      { posto: 'Teste', status: 'Aprovado', sn: 'a' },
      { posto: 'Teste', status: 'Aprovado', sn: 'a' },
    ], temStatus)
    expect(r).toEqual({ Teste: 1, 'Manutenção': 1 })
  })

  it('zera postos sem registro', () => {
    expect(contarPorPosto(['Inicial'], [], temStatus)).toEqual({ Inicial: 0, 'Manutenção': 0 })
  })
})

describe('pivotarGrade', () => {
  const linha = (pmo: string, op: string, posto: string, ap = 0, rep = 0, sem = 0, pecasOp = 0) => ({
    pmo, op, cliente: 'VMI', descricao: 'Placa', qtdOp: 100, finalizada: false,
    posto, aprovados: ap, reprovados: rep, semStatus: sem, pecasOp,
  })

  it('junta as linhas da mesma OP numa linha só, com as peças por status em cada posto', () => {
    const g = pivotarGrade(
      [linha('PMOC14', '8498', 'Printer', 0, 0, 12, 12), linha('PMOC14', '8498', 'Teste', 10, 2, 0, 12)],
      ['Printer', 'Teste'],
    )
    expect(g.ops).toHaveLength(1)
    expect(g.ops[0]!.pecas).toBe(12)
    expect(g.ops[0]!.porPosto['Printer']).toEqual({ aprovados: 0, reprovados: 0, semStatus: 12 })
    expect(g.ops[0]!.porPosto['Teste']).toEqual({ aprovados: 10, reprovados: 2, semStatus: 0 })
  })

  it('mantém a ordem das OPs que o banco mandou (mais peças primeiro), sem reordenar por nome', () => {
    const g = pivotarGrade([linha('Z', '9', 'Teste', 0, 0, 0, 50), linha('A', '1', 'Teste', 0, 0, 0, 3)], ['Teste'])
    expect(g.ops.map((o) => `${o.pmo}·${o.op}`)).toEqual(['Z·9', 'A·1'])
  })

  it('as colunas seguem a ordem do fluxo, não a ordem em que os dados chegaram', () => {
    const g = pivotarGrade(
      [linha('P', '1', 'Embalagem'), linha('P', '1', 'Printer'), linha('P', '1', 'Teste')],
      ['Printer', 'Teste', 'Embalagem'],
    )
    expect(g.postos).toEqual(['Printer', 'Teste', 'Embalagem'])
  })

  it('posto fora do cadastro vai pro fim em vez de sumir — registro antigo continua visível', () => {
    const g = pivotarGrade([linha('P', '1', 'Posto Antigo'), linha('P', '1', 'Teste')], ['Teste'])
    expect(g.postos).toEqual(['Teste', 'Posto Antigo'])
  })

  it('OP sem nenhum posto ainda assim aparece — a linha existe, só vem vazia', () => {
    const g = pivotarGrade([linha('A', '1', '')], ['Teste'])
    expect(g.ops).toHaveLength(1)
    expect(g.postos).toEqual([])
  })
})
