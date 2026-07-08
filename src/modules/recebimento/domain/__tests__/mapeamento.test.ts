import { describe, it, expect } from 'vitest'
import { normalizarNome, sugerirMapeamento } from '../mapeamento'

const campos = [
  { campo: 'numero_pedido', rotulo: 'Nº Pedido', tipo: 'texto', listaChave: null, obrigatorioImportacao: true },
  { campo: 'fornecedor', rotulo: 'Fornecedor', tipo: 'lista', listaChave: 'fornecedor', obrigatorioImportacao: false },
] as const

describe('normalizarNome', () => {
  it('remove acento, pontuação e caixa', () => {
    expect(normalizarNome('Nº Pedido')).toBe('n pedido')
  })
})

describe('sugerirMapeamento', () => {
  it('casa coluna com campo por nome normalizado (rótulo)', () => {
    const m = sugerirMapeamento(['Fornecedor', 'Nº Pedido'], [...campos])
    expect(m['fornecedor']).toBe('Fornecedor')
    expect(m['numero_pedido']).toBe('Nº Pedido')
  })
  it('não sugere quando não há coluna correspondente', () => {
    const m = sugerirMapeamento(['Outra Coluna'], [...campos])
    expect(m['fornecedor']).toBeUndefined()
  })
})
