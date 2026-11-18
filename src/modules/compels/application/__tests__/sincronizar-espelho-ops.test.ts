import { describe, expect, it, vi } from 'vitest'
import { criarNomesDeClientes, sincronizarEspelhoOps } from '../sincronizar-espelho-ops'
import type { OpEspelhoLida } from '../../domain/espelho-ops'

const op = (numero: number, cliente = ''): OpEspelhoLida => ({
  numero, idCompels: numero, codigo: 'PMOC14', descricao: '', situacao: 'Aberta', nivel: 1, quantidade: 1,
  quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente, dataDocumento: null,
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

describe('sincronizarEspelhoOps com o nome do cliente', () => {
  it('troca o código do negociante pelo nome, uma consulta por código distinto', async () => {
    const gravar = vi.fn(async () => ({ novas: 3, atualizadas: 0, inativadas: 0 }))
    const nomeCliente = vi.fn(async (c: string) => (c === '160' ? 'CLIENTE A' : 'CLIENTE B'))
    await sincronizarEspelhoOps({ listar: async () => [op(1, '160'), op(2, '160'), op(3, '7'), op(4, '')], gravar, nomeCliente })
    expect(nomeCliente.mock.calls.map((c) => c[0]).sort()).toEqual(['160', '7'])
    expect(gravar).toHaveBeenCalledWith([op(1, 'CLIENTE A'), op(2, 'CLIENTE A'), op(3, 'CLIENTE B'), op(4, '')])
  })
  it('falha num código não derruba a rodada: fica o código', async () => {
    const gravar = vi.fn(async () => ({ novas: 2, atualizadas: 0, inativadas: 0 }))
    const nomeCliente = vi.fn(async (c: string) => { if (c === '7') throw new Error('fora'); return 'CLIENTE A' })
    await sincronizarEspelhoOps({ listar: async () => [op(1, '160'), op(2, '7')], gravar, nomeCliente })
    expect(gravar).toHaveBeenCalledWith([op(1, 'CLIENTE A'), op(2, '7')])
  })
})

describe('criarNomesDeClientes', () => {
  const resposta = (codigo: string, nomeFantasia: string) => ({ results: [{ codigo, nome: 'RAZAO', nomeFantasia, inativo: false }] })

  it('guarda o nome em cache até o TTL vencer', async () => {
    let agora = 0
    const buscar = vi.fn(async (c: string) => resposta(c, 'FANTASIA'))
    const nome = criarNomesDeClientes({ buscar, agora: () => agora, ttlMs: 1000, avisar: vi.fn() })
    expect(await nome('160')).toBe('FANTASIA')
    agora = 999
    expect(await nome('160')).toBe('FANTASIA')
    expect(buscar).toHaveBeenCalledTimes(1)
    agora = 1000
    await nome('160')
    expect(buscar).toHaveBeenCalledTimes(2)
  })
  it('sem cadastro: fica o código (e também vai pro cache)', async () => {
    const buscar = vi.fn(async () => ({ results: [] }))
    const nome = criarNomesDeClientes({ buscar, agora: () => 0, avisar: vi.fn() })
    expect(await nome('160')).toBe('160')
    expect(await nome('160')).toBe('160')
    expect(buscar).toHaveBeenCalledTimes(1)
  })
  it('consulta que falha: fica o código, avisa no log e NÃO guarda (tenta de novo na próxima)', async () => {
    const buscar = vi.fn(async () => { throw new Error('Compels fora') })
    const avisar = vi.fn()
    const nome = criarNomesDeClientes({ buscar, agora: () => 0, avisar })
    expect(await nome('160')).toBe('160')
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining('160'))
    await nome('160')
    expect(buscar).toHaveBeenCalledTimes(2)
  })
})
