import { describe, expect, it } from 'vitest'
import { noDaLinhaOp } from '../arvore-op'

const LINHA_8683 = { id: 13061, numero: 8683, status: 'Em Processo', nivel: 3, ordemProducaoMaeNumero: 8682, ordemProducaoPrincipalNumero: 8681 }
const DET_8683 = { data: { composicaoProduto: { item: { codigo: 'PRT706', descricao: 'PARTES PTH DA PLACA FONTE FACIAL ' } } } }

describe('noDaLinhaOp', () => {
  it('monta o nó com mãe, principal, nível e o código do produto', () => {
    expect(noDaLinhaOp(LINHA_8683, DET_8683)).toEqual({
      numero: 8683, codigo: 'PRT706', descricao: 'PARTES PTH DA PLACA FONTE FACIAL', nivel: 3, mae: 8682, principal: 8681, status: 'Em Processo',
    })
  })
  it('raiz sem mãe/principal → null nesses campos; nível ausente vale 1', () => {
    const n = noDaLinhaOp({ numero: 8681, status: 'Aberta' }, { data: { composicaoProduto: { item: { codigo: 'PMOF48', descricao: 'COLETOR' } } } })
    expect(n).toMatchObject({ numero: 8681, mae: null, principal: null, nivel: 1 })
  })
  it('sem código do produto → null (resposta inesperada não vira nó)', () => {
    expect(noDaLinhaOp(LINHA_8683, { data: {} })).toBeNull()
  })
})
