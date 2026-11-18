import { describe, expect, it, vi } from 'vitest'
import { sincronizarEspelhoOps } from '../sincronizar-espelho-ops'
import type { OpEspelhoLida } from '../../domain/espelho-ops'

const op = (numero: number): OpEspelhoLida => ({
  numero, idCompels: numero, codigo: 'PMOC14', descricao: '', situacao: 'Aberta', nivel: 1, quantidade: 1,
  quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente: '', dataDocumento: null,
})

describe('sincronizarEspelhoOps', () => {
  it('lista e grava tudo de uma vez', async () => {
    const gravar = vi.fn(async () => ({ novas: 1, atualizadas: 1, inativadas: 0 }))
    expect(await sincronizarEspelhoOps({ listar: async () => [op(1), op(2)], gravar })).toEqual({ lidas: 2, novas: 1, atualizadas: 1, inativadas: 0 })
    expect(gravar).toHaveBeenCalledWith([op(1), op(2)])
  })
  it('lista vazia não grava (não pode inativar o espelho inteiro)', async () => {
    const gravar = vi.fn()
    await expect(sincronizarEspelhoOps({ listar: async () => [], gravar })).rejects.toThrow('O Compels devolveu a lista de OPs vazia')
    expect(gravar).not.toHaveBeenCalled()
  })
})
