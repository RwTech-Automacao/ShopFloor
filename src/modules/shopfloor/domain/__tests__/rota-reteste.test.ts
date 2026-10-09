import { describe, it, expect } from 'vitest'
import { postoEhDestinoDeRota } from '../rota-reteste'

describe('postoEhDestinoDeRota', () => {
  it('é destino quando alguém aponta para ele', () => {
    expect(postoEhDestinoDeRota('Inspeção PTH', new Set(['Inspeção PTH']))).toBe(true)
  })

  it('não é destino quando ninguém aponta', () => {
    expect(postoEhDestinoDeRota('Teste', new Set(['Inspeção PTH']))).toBe(false)
  })

  it('sem nenhuma rota configurada, nenhum posto é destino', () => {
    expect(postoEhDestinoDeRota('Inspeção PTH', new Set())).toBe(false)
  })

  it('posto vazio nunca é destino', () => {
    // O formulário começa sem posto escolhido; perguntar ali não faz sentido.
    expect(postoEhDestinoDeRota('', new Set(['']))).toBe(false)
  })

  it('compara o nome exato, sem aparar nem mudar caixa', () => {
    // A chave do posto vem do banco nos dois lados (sf_postos.chave e
    // sf_postos.retorno_pos_manutencao), então já são o mesmo texto. Normalizar aqui esconderia
    // uma configuração errada em vez de deixá-la aparecer.
    expect(postoEhDestinoDeRota('inspeção pth', new Set(['Inspeção PTH']))).toBe(false)
    expect(postoEhDestinoDeRota(' Inspeção PTH ', new Set(['Inspeção PTH']))).toBe(false)
  })
})
