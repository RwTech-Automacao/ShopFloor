import { describe, it, expect } from 'vitest'
import { finalizadaPorDoCadastro, lerResumoFinalizacao } from '../finalizacao'

describe('finalizadaPorDoCadastro', () => {
  it('FINALIZADA pela tela é "manual"', () => {
    expect(finalizadaPorDoCadastro('FINALIZADA')).toBe('manual')
  })

  it('ignora caixa e espaços, como ehOpFinalizada', () => {
    expect(finalizadaPorDoCadastro('  finalizada ')).toBe('manual')
  })

  it('ATIVA, vazio e lixo limpam a marca', () => {
    expect(finalizadaPorDoCadastro('ATIVA')).toBeNull()
    expect(finalizadaPorDoCadastro('')).toBeNull()
    expect(finalizadaPorDoCadastro('EM ANDAMENTO')).toBeNull()
  })
})

describe('lerResumoFinalizacao', () => {
  it('lê o jsonb da função', () => {
    expect(lerResumoFinalizacao({ finalizadas: 2, reabertas: 1 })).toEqual({ finalizadas: 2, reabertas: 1 })
  })

  it.each([null, undefined, 'x', 7, [], {}, { finalizadas: '2', reabertas: 1 }, { finalizadas: 1, reabertas: -1 }, { finalizadas: 1.5, reabertas: 0 }])(
    'recusa formato inesperado: %j',
    (bruto) => {
      expect(() => lerResumoFinalizacao(bruto)).toThrow(/resposta inesperada/i)
    },
  )
})
