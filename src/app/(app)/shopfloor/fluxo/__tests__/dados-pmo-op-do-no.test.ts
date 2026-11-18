import { describe, expect, it } from 'vitest'
import { dadosPmoOpDoNo } from '../dados-pmo-op-do-no'

const op = { pmo: 'PMOC14', op: '8498', descricao: 'Produto' }
describe('PMO/OP nos nós do Fluxo', () => {
  it('posto, Saída e Entrada levam pmo e op', () => {
    for (const id of ['Inspeção PTH', 'Saída', 'Entrada']) {
      expect(dadosPmoOpDoNo(id, op)).toMatchObject({ pmo: 'PMOC14', op: '8498' })
    }
  })
  it('só a Entrada leva a descrição', () => {
    expect(dadosPmoOpDoNo('Entrada', op).descricao).toBe('Produto')
    expect(dadosPmoOpDoNo('Inspeção PTH', op)).not.toHaveProperty('descricao')
  })
})
