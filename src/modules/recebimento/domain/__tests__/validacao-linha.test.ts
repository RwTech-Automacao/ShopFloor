import { describe, it, expect } from 'vitest'
import { validarLinha } from '../validacao-linha'

const campos = [
  { campo: 'numero_pedido', rotulo: 'Nº Pedido', tipo: 'texto', listaChave: null, obrigatorioImportacao: true },
  { campo: 'quantidade_pedido', rotulo: 'Qtd', tipo: 'numero', listaChave: null, obrigatorioImportacao: true },
] as const

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
