import { describe, it, expect } from 'vitest'
import { sanitizarTermoBusca, condicaoBuscaProcesso } from '../busca-processo'

describe('sanitizarTermoBusca', () => {
  it('retorna o termo original quando não há caracteres especiais', () => {
    expect(sanitizarTermoBusca('nota123')).toBe('nota123')
  })

  it('remove vírgulas (separador de condições no .or() do PostgREST)', () => {
    expect(sanitizarTermoBusca('a,b')).toBe('ab')
  })

  it('remove parênteses (delimitadores de grupo no .or())', () => {
    expect(sanitizarTermoBusca('a(b)c')).toBe('abc')
  })

  it('remove pontos (separador de path/operador no .or())', () => {
    expect(sanitizarTermoBusca('a.b')).toBe('ab')
  })

  it('remove asteriscos (podem colidir com curingas)', () => {
    expect(sanitizarTermoBusca('a*b')).toBe('ab')
  })

  it('remove o caractere % usado como curinga do ilike, para não deixar o usuário injetar curingas próprios', () => {
    expect(sanitizarTermoBusca('a%b')).toBe('ab')
  })

  it('remove múltiplos caracteres especiais combinados', () => {
    expect(sanitizarTermoBusca('a,b.c(d)e*f%g')).toBe('abcdefg')
  })

  it('preserva espaços e acentos (comuns em fornecedor/descrição)', () => {
    expect(sanitizarTermoBusca('João da Água')).toBe('João da Água')
  })

  it('remove espaços nas extremidades', () => {
    expect(sanitizarTermoBusca('  termo  ')).toBe('termo')
  })

  it('retorna string vazia para entrada composta só de caracteres especiais', () => {
    expect(sanitizarTermoBusca(',.()*%')).toBe('')
  })
})

describe('condicaoBuscaProcesso', () => {
  it('monta o or ilike quando há termo', () => {
    expect(condicaoBuscaProcesso('abc')).toBe(
      'numero_nf.ilike.%abc%,numero_pedido.ilike.%abc%,fornecedor.ilike.%abc%,codigo_material.ilike.%abc%,descricao_material.ilike.%abc%',
    )
  })
  it('retorna null sem termo real', () => {
    expect(condicaoBuscaProcesso(undefined)).toBeNull()
    expect(condicaoBuscaProcesso('   ')).toBeNull()
  })
})

import { queryProcessos } from '../busca-processo'

describe('queryProcessos', () => {
  it('monta o sufixo com busca e status', () => {
    expect(queryProcessos({ busca: 'abc', status: 'Aprovado' })).toBe('?busca=abc&status=Aprovado')
  })
  it('omite vazios / retorna "" sem filtro', () => {
    expect(queryProcessos({ busca: 'abc' })).toBe('?busca=abc')
    expect(queryProcessos({})).toBe('')
  })
})
