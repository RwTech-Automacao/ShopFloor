import { describe, it, expect } from 'vitest'
import { postoCancelavel } from '../cancelamento'

describe('postoCancelavel', () => {
  it('bloqueia postos com efeito colateral que o cancelamento não sabe desfazer', () => {
    expect(postoCancelavel('nqa')).toBe(false)
    expect(postoCancelavel('integracao')).toBe(false)
  })
  it('permite postos que só vivem em sf_registros', () => {
    expect(postoCancelavel('nenhum')).toBe(true)
    expect(postoCancelavel('burnin')).toBe(true)
  })
  it('permite embalagem: a RPC (0098) tira a peça da caixa e reabre a caixa fechada', () => {
    expect(postoCancelavel('caixa')).toBe(true)
  })
  it('permite quando o recurso é desconhecido/nulo', () => {
    expect(postoCancelavel(null)).toBe(true)
    expect(postoCancelavel(undefined)).toBe(true)
    expect(postoCancelavel('')).toBe(true)
  })
})
