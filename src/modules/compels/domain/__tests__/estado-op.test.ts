import { describe, expect, it } from 'vitest'
import { estadoDaOp, q6, type LeiturasOp } from '../estado-op'

const SEM_ESTORNO = { quantidadeEstornar: 0, situacao: 'Empenhada' }

// OP 8697 do Compels (10 un.), lida em 16/10/2026: só números, sem dado da empresa.
const OP_8697: LeiturasOp = {
  status: 'Produzida',
  tipoPropriedade: 0,
  quantidadeOp: 10,
  empenhos: [
    { quantidade: 4, ...SEM_ESTORNO },
    { quantidade: 1, ...SEM_ESTORNO },
    { quantidade: 5, ...SEM_ESTORNO },
  ],
  requisicoes: [
    { quantidade: 4, ...SEM_ESTORNO },
    { quantidade: 1, ...SEM_ESTORNO },
    { quantidade: 5, ...SEM_ESTORNO },
  ],
  apontamentos: [
    { quantidadeProduzida: 4, quantidadeCancelada: 0 },
    { quantidadeProduzida: 1, quantidadeCancelada: 0 },
    { quantidadeProduzida: 3, quantidadeCancelada: 0 },
    { quantidadeProduzida: 2, quantidadeCancelada: 0 },
  ],
}

describe('estadoDaOp', () => {
  it('soma as linhas das listas (OP 8697: 10 empenhadas, 10 requisitadas, 10 apontadas)', () => {
    expect(estadoDaOp(OP_8697)).toEqual({
      status: 'Produzida',
      tipoPropriedade: 0,
      quantidadeOp: 10,
      empenhada: 10,
      requisitada: 10,
      apontada: 10,
      temEstorno: false,
      temPendencia: false,
      inicioApontamento: null,
    })
  })

  it('OP sem nada feito tem tudo zero', () => {
    const e = estadoDaOp({ status: 'Aberta', tipoPropriedade: 0, quantidadeOp: 149, empenhos: [], requisicoes: [], apontamentos: [] })
    expect(e).toMatchObject({ empenhada: 0, requisitada: 0, apontada: 0, temEstorno: false })
  })

  it('soma decimais sem erro de ponto flutuante', () => {
    const e = estadoDaOp({
      ...OP_8697,
      apontamentos: [
        { quantidadeProduzida: 0.1, quantidadeCancelada: 0 },
        { quantidadeProduzida: 0.2, quantidadeCancelada: 0 },
      ],
    })
    expect(e.apontada).toBe(0.3)
  })

  it('marca estorno quando há quantidadeEstornar em empenho ou requisição, ou cancelamento no apontamento', () => {
    const comEmpenho = { ...OP_8697, empenhos: [{ quantidade: 10, quantidadeEstornar: 2, situacao: 'Empenhada' }] }
    const comRequisicao = { ...OP_8697, requisicoes: [{ quantidade: 10, quantidadeEstornar: 1, situacao: 'Requisitada' }] }
    const comCancelamento = { ...OP_8697, apontamentos: [{ quantidadeProduzida: 10, quantidadeCancelada: 1 }] }
    expect(estadoDaOp(comEmpenho).temEstorno).toBe(true)
    expect(estadoDaOp(comRequisicao).temEstorno).toBe(true)
    expect(estadoDaOp(comCancelamento).temEstorno).toBe(true)
  })
})

describe('pendência de material', () => {
  it('empenho ou requisição "Pendente" (falta saldo de componente) marca temPendencia', () => {
    const empenho = { ...OP_8697, empenhos: [{ quantidade: 1000, quantidadeEstornar: 0, situacao: 'Pendente' }] }
    const requisicao = { ...OP_8697, requisicoes: [{ quantidade: 1000, quantidadeEstornar: 0, situacao: 'Pendente' }] }
    expect(estadoDaOp(empenho).temPendencia).toBe(true)
    expect(estadoDaOp(requisicao).temPendencia).toBe(true)
    expect(estadoDaOp(OP_8697).temPendencia).toBe(false)
  })
})

describe('início do primeiro apontamento', () => {
  it('usa o dia mais antigo entre os apontamentos (OP 8697: sempre 30/09)', () => {
    const l = {
      ...OP_8697,
      apontamentos: [
        { quantidadeProduzida: 1, quantidadeCancelada: 0, dataInicio: '2026-09-30T00:00:00.000-03:00' },
        { quantidadeProduzida: 1, quantidadeCancelada: 0, dataInicio: '2026-09-29T00:00:00.000-03:00' },
      ],
    }
    expect(estadoDaOp(l).inicioApontamento).toBe('2026-09-29T00:00:00')
  })
})

describe('q6', () => {
  it('arredonda em 6 casas', () => {
    expect(q6(0.1 + 0.2)).toBe(0.3)
    expect(q6(1.0000004)).toBe(1)
  })
})
