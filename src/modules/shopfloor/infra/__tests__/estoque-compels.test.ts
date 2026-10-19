import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  buscarEstoqueCompels,
  limparEstoqueCompelsParaTeste,
  TTL_FALHA_MS,
  TTL_OK_MS,
} from '../estoque-compels'

const SALDO = { proprio: 28, unidade: 'UN', pendencia: 0, emTerceiros: 0, deTerceiros: 3 }

beforeEach(() => {
  limparEstoqueCompelsParaTeste()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('buscarEstoqueCompels', () => {
  it('devolve o estoque do PMO consultado agora', async () => {
    const consultar = vi.fn(async () => SALDO)
    const r = await buscarEstoqueCompels('PRT446', { cliente: { consultarSaldoItem: consultar }, agora: () => 1_000 })
    expect(r).toMatchObject({ tipo: 'ok', proprio: 28, unidade: 'UN', deTerceiros: 3 })
    expect(consultar).toHaveBeenCalledWith('PRT446')
  })

  it('guarda o resultado por 1 minuto (sem ir ao Compels de novo) e depois consulta outra vez', async () => {
    const consultar = vi.fn(async () => SALDO)
    const deps = { cliente: { consultarSaldoItem: consultar } }
    await buscarEstoqueCompels('PRT446', { ...deps, agora: () => 1_000 })
    await buscarEstoqueCompels('prt446', { ...deps, agora: () => 1_000 + TTL_OK_MS - 1 }) // maiúsculas não importam
    expect(consultar).toHaveBeenCalledTimes(1)
    await buscarEstoqueCompels('PRT446', { ...deps, agora: () => 1_000 + TTL_OK_MS + 1 })
    expect(consultar).toHaveBeenCalledTimes(2)
  })

  it('item que o Compels não tem: nao_encontrado', async () => {
    const r = await buscarEstoqueCompels('ZZZ', { cliente: { consultarSaldoItem: async () => null } })
    expect(r).toEqual({ tipo: 'nao_encontrado' })
  })

  it('falha do Compels: indisponivel, sem vazar a mensagem, lembrada por menos tempo', async () => {
    const consultar = vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443 segredo') })
    const deps = { cliente: { consultarSaldoItem: consultar } }
    const r = await buscarEstoqueCompels('PRT446', { ...deps, agora: () => 5_000 })
    expect(r).toEqual({ tipo: 'indisponivel' })
    expect(JSON.stringify(r)).not.toContain('ECONNREFUSED')

    await buscarEstoqueCompels('PRT446', { ...deps, agora: () => 5_000 + TTL_FALHA_MS - 1 })
    expect(consultar).toHaveBeenCalledTimes(1)
    await buscarEstoqueCompels('PRT446', { ...deps, agora: () => 5_000 + TTL_FALHA_MS + 1 })
    expect(consultar).toHaveBeenCalledTimes(2)
  })

  it('sem as variáveis do Compels: nao_configurado, sem tentar nada', async () => {
    vi.stubEnv('COMPELS_EZPOINT_USUARIO', '')
    vi.stubEnv('COMPELS_EZPOINT_SENHA', '')
    try {
      expect(await buscarEstoqueCompels('PRT446')).toEqual({ tipo: 'nao_configurado' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('código vazio não consulta', async () => {
    const consultar = vi.fn()
    expect(await buscarEstoqueCompels('  ', { cliente: { consultarSaldoItem: consultar } })).toEqual({ tipo: 'nao_encontrado' })
    expect(consultar).not.toHaveBeenCalled()
  })
})
