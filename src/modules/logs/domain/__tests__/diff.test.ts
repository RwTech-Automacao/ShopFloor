import { describe, it, expect } from 'vitest'
import { calcularDiff } from '../diff'

describe('calcularDiff', () => {
  it('retorna só os campos que mudaram', () => {
    const diff = calcularDiff(
      { nome: 'A', ativo: true, perfil: 'Consulta' },
      { nome: 'B', ativo: true, perfil: 'Recebimento' },
      ['nome', 'ativo', 'perfil'],
    )
    expect(diff).toEqual([
      { campo: 'nome', de: 'A', para: 'B' },
      { campo: 'perfil', de: 'Consulta', para: 'Recebimento' },
    ])
  })

  it('retorna vazio quando nada muda', () => {
    expect(calcularDiff({ a: 1 }, { a: 1 }, ['a'])).toEqual([])
  })

  it('considera apenas os campos informados', () => {
    const diff = calcularDiff({ a: 1, b: 2 }, { a: 9, b: 9 }, ['a'])
    expect(diff).toEqual([{ campo: 'a', de: 1, para: 9 }])
  })
})
