import { describe, it, expect } from 'vitest'
import { normalizarNome, sugerirMapeamento, CAMPOS_DIGITADOS, numeroEmbDoArquivo } from '../mapeamento'

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

describe('numeroEmbDoArquivo', () => {
  it('pega os 8 primeiros caracteres do nome do arquivo', () => {
    expect(numeroEmbDoArquivo('EMB341EA - ESTADOS UNIDOS.xlsx')).toBe('EMB341EA')
  })
  it('devolve o que houver quando o nome tem menos de 8 caracteres', () => {
    expect(numeroEmbDoArquivo('ABC')).toBe('ABC')
  })
  it('apara espaços nas pontas', () => {
    expect(numeroEmbDoArquivo('EMB34   - x.xlsx')).toBe('EMB34')
  })
})

describe('CAMPOS_DIGITADOS', () => {
  it('contém data_chegada e numero_emb (não são mapeados de coluna)', () => {
    expect(CAMPOS_DIGITADOS).toContain('data_chegada')
    expect(CAMPOS_DIGITADOS).toContain('numero_emb')
  })
})
