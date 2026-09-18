import { describe, it, expect } from 'vitest'
import { filtrarLinhas, valoresDistintos, valorFiltro, temFiltroAtivo, FILTROS_VAZIOS, VAZIO } from '../grade-filtro'
import type { LinhaGrade } from '../grade'

const linhas: LinhaGrade[] = [
  { sn: 'AB001C', celulas: { Teste: 'Aprovado', Embalagem: 'CX1-10', 'Manutenção': '—' } },
  { sn: 'AB002C', celulas: { Teste: 'Reprovado', Embalagem: 'Pendente', 'Manutenção': 'Concluído' } },
  { sn: 'AB003C', celulas: { Teste: 'Pendente', Embalagem: 'Pendente', 'Manutenção': '—' } },
  { sn: 'AB010C', celulas: { Teste: 'Aprovado', Embalagem: 'CX2-10', 'Manutenção': '—' } },
  { sn: 'AB011C', celulas: { Teste: 'Aprovado', Embalagem: 'Registrado', 'Manutenção': 'Concluído' } },
]
const sns = (ls: LinhaGrade[]) => ls.map((l) => l.sn)

describe('valorFiltro', () => {
  it('Pendente, — e vazio viram Pendente', () => {
    expect(valorFiltro('Pendente')).toBe(VAZIO)
    expect(valorFiltro('—')).toBe(VAZIO)
    expect(valorFiltro('')).toBe(VAZIO)
    expect(valorFiltro(undefined)).toBe(VAZIO)
    expect(valorFiltro('Aprovado')).toBe('Aprovado')
  })
})

describe('valoresDistintos', () => {
  it('ordena com Pendente no fim', () => {
    expect(valoresDistintos(linhas, 'Teste')).toEqual(['Aprovado', 'Reprovado', VAZIO])
    expect(valoresDistintos(linhas, 'Embalagem')).toEqual(['CX1-10', 'CX2-10', 'Registrado', VAZIO])
    expect(valoresDistintos(linhas, 'Manutenção')).toEqual(['Concluído', VAZIO])
  })
  it('sem vazio não inclui Pendente; ordem numérica', () => {
    const ls: LinhaGrade[] = [
      { sn: 'a', celulas: { Embalagem: 'CX10' } },
      { sn: 'b', celulas: { Embalagem: 'CX2' } },
    ]
    expect(valoresDistintos(ls, 'Embalagem')).toEqual(['CX2', 'CX10'])
  })
})

describe('filtrarLinhas', () => {
  it('sem filtro devolve tudo', () => {
    expect(filtrarLinhas(linhas, FILTROS_VAZIOS)).toEqual(linhas)
    expect(temFiltroAtivo(FILTROS_VAZIOS)).toBe(false)
  })
  it('OU dentro da coluna', () => {
    const r = filtrarLinhas(linhas, { sn: '', valores: { Teste: ['Reprovado', VAZIO] } })
    expect(sns(r)).toEqual(['AB002C', 'AB003C'])
  })
  it('E entre colunas', () => {
    const r = filtrarLinhas(linhas, { sn: '', valores: { Teste: ['Aprovado'], 'Manutenção': ['Concluído'] } })
    expect(sns(r)).toEqual(['AB011C'])
  })
  it('Pendente casa a peça que não passou pelo posto', () => {
    const r = filtrarLinhas(linhas, { sn: '', valores: { Embalagem: [VAZIO] } })
    expect(sns(r)).toEqual(['AB002C', 'AB003C'])
  })
  it('texto do SN (contém, sem maiúsculas) combina com E', () => {
    expect(sns(filtrarLinhas(linhas, { sn: 'b01', valores: {} }))).toEqual(['AB010C', 'AB011C'])
    expect(sns(filtrarLinhas(linhas, { sn: 'b01', valores: { Embalagem: ['CX2-10'] } }))).toEqual(['AB010C'])
    expect(temFiltroAtivo({ sn: ' x ', valores: {} })).toBe(true)
  })
  it('ignora separadores dos dois lados ("AB-010" acha "AB010C")', () => {
    expect(sns(filtrarLinhas(linhas, { sn: 'AB-010', valores: {} }))).toEqual(['AB010C'])
  })
  it('lista vazia numa coluna = nenhuma linha', () => {
    expect(filtrarLinhas(linhas, { sn: '', valores: { Teste: [] } })).toEqual([])
  })
})
