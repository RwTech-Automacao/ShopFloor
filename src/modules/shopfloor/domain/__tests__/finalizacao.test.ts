import { describe, it, expect } from 'vitest'
import { ehReativacaoManual, finalizadaPorDoCadastro, lerResumoFinalizacao } from '../finalizacao'

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

describe('ehReativacaoManual', () => {
  it('FINALIZADA -> ATIVA é reativação (é o que tira a OP do automático)', () => {
    expect(ehReativacaoManual('FINALIZADA', 'ATIVA')).toBe(true)
  })

  it('ignora caixa e espaços nos dois lados', () => {
    expect(ehReativacaoManual(' finalizada ', 'ativa')).toBe(true)
    expect(ehReativacaoManual('ativa', ' FINALIZADA ')).toBe(false)
  })

  it('editar uma OP que já estava ativa NÃO é reativação', () => {
    // Se fosse, qualquer edição de OP a tiraria do controle automático.
    expect(ehReativacaoManual('ATIVA', 'ATIVA')).toBe(false)
    expect(ehReativacaoManual('', '')).toBe(false)
    expect(ehReativacaoManual('EM ANDAMENTO', 'ATIVA')).toBe(false)
  })

  it('continuar finalizada não é reativação', () => {
    expect(ehReativacaoManual('FINALIZADA', 'FINALIZADA')).toBe(false)
  })

  it('status anterior desconhecido (nulo) não é reativação', () => {
    // OP que não foi encontrada no banco: na dúvida, não tira do automático.
    expect(ehReativacaoManual(null, 'ATIVA')).toBe(false)
    expect(ehReativacaoManual(undefined, 'ATIVA')).toBe(false)
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
