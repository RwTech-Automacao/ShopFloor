import { describe, expect, it } from 'vitest'
import { ehRotaDoEspelhoDeOps } from '../rotas-espelho-ops'

describe('ehRotaDoEspelhoDeOps', () => {
  it('só a rota exata (com ou sem barra final) sai da sessão', () => {
    expect(ehRotaDoEspelhoDeOps('/api/compels/espelho-ops')).toBe(true)
    expect(ehRotaDoEspelhoDeOps('/api/compels/espelho-ops/')).toBe(true)
    expect(ehRotaDoEspelhoDeOps('/api/compels/espelho-ops/x')).toBe(false)
    expect(ehRotaDoEspelhoDeOps('/api/compels/espelho-opsx')).toBe(false)
  })
})
