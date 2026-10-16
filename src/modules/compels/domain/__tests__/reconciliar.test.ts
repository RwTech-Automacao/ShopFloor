import { describe, expect, it } from 'vitest'
import type { EstadoOpErp } from '../estado-op'
import { decidirEntrada, MENSAGEM_ERRO } from '../reconciliar'

const base: EstadoOpErp = {
  status: 'Em Processo',
  tipoPropriedade: 0,
  quantidadeOp: 10,
  empenhada: 10,
  requisitada: 0,
  apontada: 0,
  temEstorno: false,
  temPendencia: false,
}
const com = (parcial: Partial<EstadoOpErp>): EstadoOpErp => ({ ...base, ...parcial })

describe('decidirEntrada', () => {
  it('primeira entrada: requisita e aponta a quantidade', () => {
    expect(decidirEntrada(base, { anterior: 0, novo: 4 })).toEqual({ tipo: 'enviar', requisitar: 4, apontar: 4 })
  })

  it('toda entrada é uma requisição + um apontamento da mesma quantidade', () => {
    const estado = com({ requisitada: 4, apontada: 4 })
    expect(decidirEntrada(estado, { anterior: 4, novo: 5 })).toEqual({ tipo: 'enviar', requisitar: 1, apontar: 1 })
  })

  it('requisição feita à frente (OP 8697: 5 requisitadas, apontadas em 3 + 2) não é tratada: para', () => {
    const estado = com({ requisitada: 10, apontada: 5 })
    expect(decidirEntrada(estado, { anterior: 5, novo: 8 })).toMatchObject({
      tipo: 'erro',
      codigo: 'requisicao_fora_do_esperado',
    })
  })

  it('já enviada: o ERP cobre a entrada (retomada depois de falha no meio)', () => {
    const estado = com({ requisitada: 4, apontada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({ tipo: 'ja_enviada' })
  })

  it('já enviada tem prioridade sobre falta de empenho', () => {
    const estado = com({ empenhada: 0, requisitada: 4, apontada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({ tipo: 'ja_enviada' })
  })

  it('falha no meio: a requisição desta entrada já foi feita e o apontamento não, então só falta apontar', () => {
    const estado = com({ requisitada: 4, apontada: 0 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({ tipo: 'enviar', requisitar: 0, apontar: 4 })
  })

  it('sem empenho suficiente', () => {
    const estado = com({ empenhada: 3 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toMatchObject({ tipo: 'erro', codigo: 'sem_empenho' })
  })

  it('empenho exato basta', () => {
    const estado = com({ empenhada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 }).tipo).toBe('enviar')
  })

  it('apontamento manual no meio: ERP com valor que não é o esperado', () => {
    const estado = com({ apontada: 3, requisitada: 3 })
    expect(decidirEntrada(estado, { anterior: 4, novo: 6 })).toMatchObject({ tipo: 'erro', codigo: 'abaixo_do_enviado' })
    expect(decidirEntrada(estado, { anterior: 1, novo: 6 })).toMatchObject({ tipo: 'erro', codigo: 'fora_do_esperado' })
  })

  it('pendência de material no ERP para a integração (e entrada já enviada continua "já enviada")', () => {
    expect(decidirEntrada(com({ temPendencia: true }), { anterior: 0, novo: 4 })).toMatchObject({
      tipo: 'erro',
      codigo: 'pendencia_no_erp',
    })
    expect(decidirEntrada(com({ temPendencia: true, apontada: 4 }), { anterior: 0, novo: 4 })).toEqual({
      tipo: 'ja_enviada',
    })
  })

  it('entrega acima da OP', () => {
    expect(decidirEntrada(base, { anterior: 8, novo: 11 })).toMatchObject({ tipo: 'erro', codigo: 'acima_da_op' })
  })

  it('estoque que não é próprio (em terceiros) não é tratado pela integração', () => {
    expect(decidirEntrada(com({ tipoPropriedade: 1 }), { anterior: 0, novo: 4 })).toMatchObject({
      tipo: 'erro',
      codigo: 'propriedade_nao_suportada',
    })
  })

  it('estorno na OP para a integração', () => {
    expect(decidirEntrada(com({ temEstorno: true }), { anterior: 0, novo: 4 })).toMatchObject({
      tipo: 'erro',
      codigo: 'estorno_na_op',
    })
  })

  it('quantidade zero ou negativa é inválida', () => {
    expect(decidirEntrada(base, { anterior: 4, novo: 4 })).toMatchObject({ codigo: 'quantidade_invalida' })
    expect(decidirEntrada(base, { anterior: 5, novo: 4 })).toMatchObject({ codigo: 'quantidade_invalida' })
  })

  it('compara decimais sem erro de ponto flutuante', () => {
    const estado = com({ requisitada: 0.3, apontada: 0.3, empenhada: 1 })
    expect(decidirEntrada(estado, { anterior: 0.1 + 0.2, novo: 0.6 })).toEqual({
      tipo: 'enviar',
      requisitar: 0.3,
      apontar: 0.3,
    })
  })

  it('toda decisão de erro traz a mensagem legível do código', () => {
    const d = decidirEntrada(com({ empenhada: 0 }), { anterior: 0, novo: 1 })
    expect(d).toEqual({ tipo: 'erro', codigo: 'sem_empenho', mensagem: MENSAGEM_ERRO.sem_empenho })
  })
})
