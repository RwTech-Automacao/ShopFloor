import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  buscarEstoqueCompels,
  limparEstoqueCompelsParaTeste,
  TTL_FALHA_MS,
  TTL_OK_MS,
} from '../estoque-compels'

const SALDO = [
  { estoque: 'PA', descricao: 'PRODUTO ACABADO', saldo: 20 },
  { estoque: 'EINTER', descricao: 'ESTOQUE INTERMEDIARIO', saldo: 8 },
  { estoque: 'EA', descricao: 'ESTOQUE DE ATIVO', saldo: 49 },
]

beforeEach(() => {
  limparEstoqueCompelsParaTeste()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('buscarEstoqueCompels', () => {
  it('devolve o estoque do PMO consultado agora', async () => {
    const consultar = vi.fn(async () => SALDO)
    const r = await buscarEstoqueCompels('PRT446', { cliente: { consultarSaldoPorEstoque: consultar }, agora: () => 1_000 })
    // Só PA + EINTER contam; o estoque de ativo (EA) fica de fora.
    expect(r).toMatchObject({ tipo: 'ok', disponivel: 28, porEstoque: [{ estoque: 'PA', saldo: 20 }, { estoque: 'EINTER', saldo: 8 }] })
    expect(consultar).toHaveBeenCalledWith('PRT446')
  })

  it('guarda o resultado por 1 minuto (sem ir ao Compels de novo) e depois consulta outra vez', async () => {
    const consultar = vi.fn(async () => SALDO)
    const deps = { cliente: { consultarSaldoPorEstoque: consultar } }
    await buscarEstoqueCompels('PRT446', { ...deps, agora: () => 1_000 })
    await buscarEstoqueCompels('prt446', { ...deps, agora: () => 1_000 + TTL_OK_MS - 1 }) // maiúsculas não importam
    expect(consultar).toHaveBeenCalledTimes(1)
    await buscarEstoqueCompels('PRT446', { ...deps, agora: () => 1_000 + TTL_OK_MS + 1 })
    expect(consultar).toHaveBeenCalledTimes(2)
  })

  it('PMO de segunda leva (sufixo _F ou _): consulta o item do Compels sem o sufixo e compartilha o cache', async () => {
    const consultar = vi.fn(async () => SALDO)
    const deps = { cliente: { consultarSaldoPorEstoque: consultar }, agora: () => 1_000 }
    expect(await buscarEstoqueCompels('PMOF52_F', deps)).toMatchObject({ tipo: 'ok', disponivel: 28 })
    expect(consultar).toHaveBeenCalledWith('PMOF52')
    await buscarEstoqueCompels('PMOF52', deps)
    await buscarEstoqueCompels('PMOF52_', deps)
    expect(consultar).toHaveBeenCalledTimes(1)
  })

  it('item sem saldo em nenhum estoque: zero disponível', async () => {
    const r = await buscarEstoqueCompels('ZZZ', { cliente: { consultarSaldoPorEstoque: async () => [] }, agora: () => 1_000 })
    expect(r).toMatchObject({ tipo: 'ok', disponivel: 0, porEstoque: [{ estoque: 'PA', saldo: 0 }, { estoque: 'EINTER', saldo: 0 }] })
  })

  it('falha do Compels: indisponivel, sem vazar a mensagem, lembrada por menos tempo', async () => {
    const consultar = vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443 segredo') })
    const deps = { cliente: { consultarSaldoPorEstoque: consultar } }
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
    expect(await buscarEstoqueCompels('  ', { cliente: { consultarSaldoPorEstoque: consultar } })).toEqual({ tipo: 'nao_encontrado' })
    expect(consultar).not.toHaveBeenCalled()
  })
})
