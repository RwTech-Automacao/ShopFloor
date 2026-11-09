// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { chaveDoQuiosqueConfere } from '../quiosque-fichas'

describe('chaveDoQuiosqueConfere', () => {
  it('confere só com a chave exata', () => {
    expect(chaveDoQuiosqueConfere('abc123', 'abc123')).toBe(true)
    expect(chaveDoQuiosqueConfere('abc124', 'abc123')).toBe(false)
    expect(chaveDoQuiosqueConfere('abc1234', 'abc123')).toBe(false)
    expect(chaveDoQuiosqueConfere(null, 'abc123')).toBe(false)
    expect(chaveDoQuiosqueConfere('', 'abc123')).toBe(false)
  })

  it('variável vazia, só espaços ou ausente = página desligada, mesmo com k vazio', () => {
    expect(chaveDoQuiosqueConfere('', '')).toBe(false)
    expect(chaveDoQuiosqueConfere('', '   ')).toBe(false)
    expect(chaveDoQuiosqueConfere(' ', ' ')).toBe(false)
    expect(chaveDoQuiosqueConfere('x', undefined)).toBe(false)
  })

  it('espaços em volta da variável são ignorados', () => {
    expect(chaveDoQuiosqueConfere('abc123', ' abc123\n')).toBe(true)
  })
})
