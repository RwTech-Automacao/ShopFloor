import { describe, expect, it } from 'vitest'
import { COLUNAS_FIXAS, normalizarLayout } from '../layout-colunas'

const CATALOGO = ['numero', 'status', 'fornecedor', 'tipo', 'atraso']

const visiveisDe = (r: { campo: string; visivel: boolean }[]) =>
  r.filter((c) => c.visivel).map((c) => c.campo)
const ocultasDe = (r: { campo: string; visivel: boolean }[]) =>
  r.filter((c) => !c.visivel).map((c) => c.campo)

describe('COLUNAS_FIXAS', () => {
  it('são numero e status', () => {
    expect([...COLUNAS_FIXAS]).toEqual(['numero', 'status'])
  })
})

describe('normalizarLayout', () => {
  it('numera as visíveis 1..N na ordem dada e as ocultas depois', () => {
    expect(normalizarLayout(['numero', 'fornecedor', 'status'], CATALOGO)).toEqual([
      { campo: 'numero', visivel: true, ordem: 1 },
      { campo: 'fornecedor', visivel: true, ordem: 2 },
      { campo: 'status', visivel: true, ordem: 3 },
      { campo: 'tipo', visivel: false, ordem: 4 },
      { campo: 'atraso', visivel: false, ordem: 5 },
    ])
  })

  it('descarta campo fora do catálogo', () => {
    const r = normalizarLayout(['numero', 'hacker', 'status'], CATALOGO)
    expect(visiveisDe(r)).toEqual(['numero', 'status'])
    expect(r.some((c) => c.campo === 'hacker')).toBe(false)
  })

  it('descarta duplicatas', () => {
    const r = normalizarLayout(['numero', 'numero', 'status'], CATALOGO)
    expect(visiveisDe(r)).toEqual(['numero', 'status'])
  })

  it('força as fixas visíveis quando omitidas (entram no fim)', () => {
    const r = normalizarLayout(['fornecedor'], CATALOGO)
    expect(visiveisDe(r)).toEqual(['fornecedor', 'numero', 'status'])
  })

  it('lista vazia → só as fixas visíveis', () => {
    const r = normalizarLayout([], CATALOGO)
    expect(visiveisDe(r)).toEqual(['numero', 'status'])
    expect(ocultasDe(r)).toEqual(['fornecedor', 'tipo', 'atraso'])
  })

  it('ocultas seguem a ordem do catálogo', () => {
    const r = normalizarLayout(['numero', 'status'], CATALOGO)
    expect(ocultasDe(r)).toEqual(['fornecedor', 'tipo', 'atraso'])
  })

  it('cobre o catálogo inteiro, sem duplicar', () => {
    const r = normalizarLayout(['tipo', 'numero'], CATALOGO)
    expect(r).toHaveLength(CATALOGO.length)
    expect(new Set(r.map((c) => c.campo)).size).toBe(CATALOGO.length)
  })

  it('não muta as entradas', () => {
    const vis = ['numero', 'fornecedor']
    const cat = [...CATALOGO]
    normalizarLayout(vis, cat)
    expect(vis).toEqual(['numero', 'fornecedor'])
    expect(cat).toEqual(CATALOGO)
  })
})
