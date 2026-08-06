import { describe, it, expect } from 'vitest'
import { mensagemOpDuplicada } from '../op-unica'

describe('mensagemOpDuplicada', () => {
  it('nomeia a OP e o PMO conflitante', () => {
    const msg = mensagemOpDuplicada({ pmo: 'PMOC64', op: '8019' })
    expect(msg).toContain('8019')
    expect(msg).toContain('PMOC64')
    expect(msg).toContain('único')
  })
})
