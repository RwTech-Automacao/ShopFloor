import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/modules/faturamento/infra/compels', () => ({ clienteCompelsDoFaturamento: () => null }))

import { empresaDoCnpj } from '../compels'

// Respostas fictícias de `negociante/list` (nada de cadastro real).
const achado = { results: [{ codigo: 'C0001', cpfCnpj: '12.345.678/0001-90', nome: 'CLIENTE FICTICIO', inativo: false }] }
const vazio = { results: [] }

describe('empresaDoCnpj', () => {
  it('tenta primeiro com a máscara (formato de quase todo o cadastro)', async () => {
    const buscarNegociantes = vi.fn(async () => achado)
    expect(await empresaDoCnpj('12345678000190', { buscarNegociantes })).toEqual({ codigo: 'C0001', nome: 'CLIENTE FICTICIO' })
    expect(buscarNegociantes).toHaveBeenCalledTimes(1)
    expect(buscarNegociantes).toHaveBeenCalledWith('12.345.678/0001-90')
  })

  it('sem resultado com a máscara, tenta só os dígitos', async () => {
    const soDigitos = { results: [{ ...achado.results[0], cpfCnpj: '12345678000190' }] }
    const buscarNegociantes = vi.fn(async (c: string) => (c.includes('.') ? vazio : soDigitos))
    expect(await empresaDoCnpj('12.345.678/0001-90', { buscarNegociantes })).toEqual({ codigo: 'C0001', nome: 'CLIENTE FICTICIO' })
    expect(buscarNegociantes.mock.calls).toEqual([['12.345.678/0001-90'], ['12345678000190']])
  })

  it('não achou de nenhum jeito: null', async () => {
    const buscarNegociantes = vi.fn(async () => vazio)
    expect(await empresaDoCnpj('12345678000190', { buscarNegociantes })).toBeNull()
    expect(buscarNegociantes).toHaveBeenCalledTimes(2)
  })

  it('CNPJ inválido: nem consulta', async () => {
    const buscarNegociantes = vi.fn(async () => achado)
    expect(await empresaDoCnpj('123', { buscarNegociantes })).toBeNull()
    expect(buscarNegociantes).not.toHaveBeenCalled()
  })

  it('Compels fora do ar ou sem configuração: null (a pessoa digita a empresa)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await empresaDoCnpj('12345678000190', { buscarNegociantes: vi.fn(async () => { throw new Error('fora do ar') }) })).toBeNull()
    expect(await empresaDoCnpj('12345678000190', null)).toBeNull()
    expect(await empresaDoCnpj('12345678000190')).toBeNull()
  })
})
