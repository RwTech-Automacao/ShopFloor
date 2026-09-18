import { describe, it, expect } from 'vitest'
import { compararEstrutura } from '../estrutura-previa'

describe('compararEstrutura', () => {
  it('separa novos, iguais, processo alterado e ausentes', () => {
    const atual = [
      { componente: 'CAPJ41', processo: 'SMD' as const },
      { componente: 'BAR180', processo: 'SMD' as const },
      { componente: 'OLD001', processo: 'SMD' as const },
    ]
    const arquivo = [
      { componente: 'CAPJ41', processo: 'SMD' as const },
      { componente: 'BAR180', processo: 'PTH' as const },
      { componente: 'NEW002', processo: 'PTH' as const },
    ]
    expect(compararEstrutura(atual, arquivo)).toEqual({
      novos: [{ componente: 'NEW002', processo: 'PTH' }],
      iguais: [{ componente: 'CAPJ41', processo: 'SMD' }],
      processoAlterado: [{ componente: 'BAR180', processo: 'PTH', processoAtual: 'SMD' }],
      ausentesNoArquivo: [{ componente: 'OLD001', processo: 'SMD' }],
    })
  })
})
