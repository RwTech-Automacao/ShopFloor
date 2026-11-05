import { describe, expect, it } from 'vitest'
import type { EstadoOpErp } from '../estado-op'
import { decidirEntrada } from '../reconciliar'

const base: EstadoOpErp = {
  status: 'Em Processo',
  tipoPropriedade: 0,
  quantidadeOp: 10,
  empenhada: 10,
  requisitada: 0,
  apontada: 0,
  temEstorno: false,
  temPendencia: false,
  inicioApontamento: null,
}
const com = (parcial: Partial<EstadoOpErp>): EstadoOpErp => ({ ...base, ...parcial })

describe('decidirEntrada', () => {
  it('primeira entrada com requisição suficiente: só aponta, sem avisos', () => {
    const estado = com({ requisitada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({ tipo: 'enviar', apontar: 4, avisos: [] })
  })

  it('requisição maior que o necessário serve (não precisa ser exata): OP 8697 com 10 requisitadas e 5 apontadas', () => {
    const estado = com({ requisitada: 10, apontada: 5 })
    expect(decidirEntrada(estado, { anterior: 5, novo: 8 })).toEqual({ tipo: 'enviar', apontar: 3, avisos: [] })
  })

  it('requisição insuficiente NÃO bloqueia: vira aviso com o quanto falta', () => {
    const estado = com({ requisitada: 1 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({
      tipo: 'enviar',
      apontar: 4,
      avisos: ['requisição insuficiente no Compels: requisitado 1, precisa de 4 (faltam 3)'],
    })
  })

  it('já enviada: o ERP cobre a entrada (retomada depois de falha no meio)', () => {
    const estado = com({ requisitada: 4, apontada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({ tipo: 'ja_enviada' })
  })

  it('OP com apontamento de fora (22 apontadas à mão, esta entrada vai a 6): erro, NÃO "já enviada"', () => {
    const estado = com({ quantidadeOp: 100, empenhada: 22, requisitada: 22, apontada: 22 })
    const d = decidirEntrada(estado, { anterior: 0, novo: 6 })
    expect(d).toMatchObject({ tipo: 'erro', codigo: 'fora_do_esperado' })
    expect(d.tipo === 'erro' && d.mensagem).toContain('22 apontadas')
    expect(d.tipo === 'erro' && d.mensagem).toContain('não veio desta integração')
  })

  it('já enviada tem prioridade sobre falta de empenho', () => {
    const estado = com({ empenhada: 0, requisitada: 4, apontada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({ tipo: 'ja_enviada' })
  })

  it('empenho insuficiente NÃO bloqueia: vira aviso com o quanto falta', () => {
    const estado = com({ empenhada: 3, requisitada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({
      tipo: 'enviar',
      apontar: 4,
      avisos: ['empenho insuficiente no Compels: empenhado 3, precisa de 4 (faltam 1)'],
    })
  })

  it('empenho e requisição exatos bastam, sem avisos', () => {
    const estado = com({ empenhada: 4, requisitada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({ tipo: 'enviar', apontar: 4, avisos: [] })
  })

  it('apontamento manual no meio: ERP com valor que não é o esperado', () => {
    const estado = com({ apontada: 3, requisitada: 3 })
    expect(decidirEntrada(estado, { anterior: 4, novo: 6 })).toMatchObject({ tipo: 'erro', codigo: 'abaixo_do_enviado' })
    expect(decidirEntrada(estado, { anterior: 1, novo: 6 })).toMatchObject({ tipo: 'erro', codigo: 'fora_do_esperado' })
  })

  it('requisição Pendente não tem regra própria: o que decide é o saldo disponível, conferido na aplicação', () => {
    const estado = com({ temPendencia: true, requisitada: 4 })
    expect(decidirEntrada(estado, { anterior: 0, novo: 4 })).toEqual({ tipo: 'enviar', apontar: 4, avisos: [] })
    expect(decidirEntrada(com({ temPendencia: true, apontada: 4 }), { anterior: 0, novo: 4 })).toEqual({ tipo: 'ja_enviada' })
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
    const estado = com({ requisitada: 0.6, apontada: 0.3, empenhada: 1 })
    expect(decidirEntrada(estado, { anterior: 0.1 + 0.2, novo: 0.6 })).toEqual({ tipo: 'enviar', apontar: 0.3, avisos: [] })
  })

  it('toda decisão de erro traz a mensagem legível do código', () => {
    const d = decidirEntrada(com({ temEstorno: true }), { anterior: 0, novo: 1 })
    expect(d).toMatchObject({ tipo: 'erro', codigo: 'estorno_na_op' })
    expect(d.tipo === 'erro' && d.mensagem.length > 0).toBe(true)
  })
})
