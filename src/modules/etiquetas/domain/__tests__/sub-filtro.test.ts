import { describe, expect, it } from 'vitest'
import {
  SUB_FILTRO_PADRAO,
  aplicarSubFiltro,
  valoresDistintosSub,
  type Acessor,
  type SubFiltroEtiquetas,
} from '../sub-filtro'

type Linha = { numero: number; status: string; codigo: string | null; doc: string }

const ACESSORES: Record<string, Acessor<Linha>> = {
  numero: (l) => l.numero,
  status: (l) => l.status,
  codigo: (l) => l.codigo ?? '',
  doc: (l) => l.doc,
}

const LINHAS: Linha[] = [
  { numero: 57, status: 'Aprovado', codigo: 'BETA', doc: 'DI1' },
  { numero: 12, status: 'aberto', codigo: 'ALFA', doc: 'DI2' },
  { numero: 34, status: 'Aprovado', codigo: null, doc: 'DI3' },
]

describe('valoresDistintosSub', () => {
  it('distintos, ordenados, sem vazios', () => {
    expect(valoresDistintosSub(LINHAS, ACESSORES.status!)).toEqual(['aberto', 'Aprovado'])
    expect(valoresDistintosSub(LINHAS, ACESSORES.codigo!)).toEqual(['ALFA', 'BETA']) // null omitido
  })
})

describe('aplicarSubFiltro', () => {
  it('sem filtro nem ordenação mantém a ordem original', () => {
    expect(aplicarSubFiltro(LINHAS, SUB_FILTRO_PADRAO, ACESSORES)).toEqual(LINHAS)
  })

  it('filtra por texto (case-insensitive)', () => {
    const sf: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, filtros: { codigo: { texto: 'alf' } } }
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.numero)).toEqual([12])
  })

  it('filtra por valores (checkbox)', () => {
    const sf: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, filtros: { status: { valores: ['Aprovado'] } } }
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.numero)).toEqual([57, 34])
  })

  it('ordena Nº numericamente (não alfabético)', () => {
    const asc: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, ordenar: 'numero', direcao: 'asc' }
    expect(aplicarSubFiltro(LINHAS, asc, ACESSORES).map((l) => l.numero)).toEqual([12, 34, 57])
    const desc: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, ordenar: 'numero', direcao: 'desc' }
    expect(aplicarSubFiltro(LINHAS, desc, ACESSORES).map((l) => l.numero)).toEqual([57, 34, 12])
  })

  it('ordena texto por localeCompare', () => {
    const sf: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, ordenar: 'codigo', direcao: 'asc' }
    // codigo null vira '' → vai para o fim
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.codigo)).toEqual(['ALFA', 'BETA', null])
  })

  it('vazios sempre por último, mesmo em desc', () => {
    const sf: SubFiltroEtiquetas = { ...SUB_FILTRO_PADRAO, ordenar: 'codigo', direcao: 'desc' }
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.codigo)).toEqual(['BETA', 'ALFA', null])
  })

  it('combina texto + valores', () => {
    const sf: SubFiltroEtiquetas = {
      ...SUB_FILTRO_PADRAO,
      filtros: { status: { valores: ['Aprovado'] }, doc: { texto: 'di1' } },
    }
    expect(aplicarSubFiltro(LINHAS, sf, ACESSORES).map((l) => l.numero)).toEqual([57])
  })

  it('não muta a entrada', () => {
    const copia = LINHAS.map((l) => ({ ...l }))
    aplicarSubFiltro(LINHAS, { ...SUB_FILTRO_PADRAO, ordenar: 'numero', direcao: 'asc' }, ACESSORES)
    expect(LINHAS).toEqual(copia)
  })
})
