import { describe, it, expect } from 'vitest'
import { postoCancelavel } from '../cancelamento'

describe('postoCancelavel', () => {
  it('bloqueia postos com efeito colateral', () => {
    expect(postoCancelavel('caixa')).toBe(false)
    expect(postoCancelavel('nqa')).toBe(false)
    expect(postoCancelavel('integracao')).toBe(false)
  })
  it('permite postos que só vivem em sf_registros', () => {
    expect(postoCancelavel('nenhum')).toBe(true)
    expect(postoCancelavel('burnin')).toBe(true)
  })
  it('permite quando o recurso é desconhecido/nulo', () => {
    expect(postoCancelavel(null)).toBe(true)
    expect(postoCancelavel(undefined)).toBe(true)
    expect(postoCancelavel('')).toBe(true)
  })
})
