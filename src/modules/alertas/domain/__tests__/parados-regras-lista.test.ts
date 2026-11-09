import { describe, expect, it } from 'vitest'
import { lerListaDeRegras, opcoesDoSeletor, regraEscolhida } from '../parados-relatorio'

describe('lerListaDeRegras', () => {
  it('lê id e nome na ordem do banco e descarta linhas sem id', () => {
    expect(lerListaDeRegras([
      { id: 'r1', nome: 'Alfa' },
      { id: '', nome: 'sem id' },
      null,
      { id: 'r2', nome: null },
      { nome: 'x' },
    ])).toEqual([{ id: 'r1', nome: 'Alfa' }, { id: 'r2', nome: '' }])
  })
  it('resposta que não é lista vira lista vazia', () => {
    expect(lerListaDeRegras(null)).toEqual([])
    expect(lerListaDeRegras({ id: 'r1' })).toEqual([])
  })
})

describe('regraEscolhida', () => {
  const lista = [{ id: 'r1', nome: 'Alfa' }, { id: 'r2', nome: 'Beta' }]
  it('a regra do link vale, mesmo fora da lista (desativada)', () => {
    expect(regraEscolhida('rX', lista)).toBe('rX')
    expect(regraEscolhida('  r2 ', lista)).toBe('r2')
  })
  it('sem regra no link abre na primeira da lista', () => {
    expect(regraEscolhida('', lista)).toBe('r1')
    expect(regraEscolhida('   ', lista)).toBe('r1')
  })
  it('sem regra no link e sem regra ativa: nenhuma', () => {
    expect(regraEscolhida('', [])).toBeNull()
  })
})

describe('opcoesDoSeletor', () => {
  const lista = [{ id: 'r1', nome: 'Alfa' }, { id: 'r2', nome: '' }]
  it('as ativas, com "(sem nome)" para nome vazio', () => {
    expect(opcoesDoSeletor(lista, { id: 'r1', nome: 'Alfa' })).toEqual([
      { id: 'r1', rotulo: 'Alfa' }, { id: 'r2', rotulo: '(sem nome)' },
    ])
  })
  it('a regra aberta pelo link que não está entre as ativas entra no fim, marcada como desativada', () => {
    expect(opcoesDoSeletor(lista, { id: 'r9', nome: 'Velha' })).toEqual([
      { id: 'r1', rotulo: 'Alfa' }, { id: 'r2', rotulo: '(sem nome)' }, { id: 'r9', rotulo: 'Velha (desativada)' },
    ])
  })
  it('sem regra aberta: só as ativas', () => {
    expect(opcoesDoSeletor(lista, null)).toHaveLength(2)
  })
})
