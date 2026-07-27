import { describe, it, expect } from 'vitest'
import { contarPorPosto } from '../dashboard'

describe('contarPorPosto', () => {
  const postos = ['Inicial', 'Teste', 'Embalagem']
  it('sem-status conta cada registro; com-status só aprovado; Manutenção incluída', () => {
    const r = contarPorPosto(postos, [
      { posto: 'Inicial', status: '' },
      { posto: 'Inicial', status: '' },
      { posto: 'Teste', status: 'Reprovado' },
      { posto: 'Teste', status: 'Aprovado' },
      { posto: 'Embalagem', status: '' },
      { posto: 'Manutenção', status: '' },
      { posto: 'Inspeção SMD', status: 'Aprovado' }, // fora do fluxo → ignora
    ])
    expect(r).toEqual({ Inicial: 2, Teste: 1, Embalagem: 1, 'Manutenção': 1 })
  })
  it('zera postos sem registro', () => {
    expect(contarPorPosto(['Inicial'], [])).toEqual({ Inicial: 0, 'Manutenção': 0 })
  })
})
