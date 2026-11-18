import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.hoisted(() => vi.fn())
const consulta = vi.hoisted(() => ({ select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc, from: () => consulta }) }))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { listarTrechosDaOp, resumoTrechosDaOp } from '../estrutura-repository'

describe('resumoTrechosDaOp', () => {
  it('uma chamada à sf_resumo_trechos_op, convertida para o card', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { posto: 'Inspeção AOI TOP', codigo: 'PRT410', compels_op: '8500', apontadas: 2, na_fila: 3, motivo: 'E-velho' },
        { posto: 'Inspeção PTH', codigo: 'PRT420', compels_op: null, apontadas: null, na_fila: null, motivo: null },
      ],
      error: null,
    })
    expect(await resumoTrechosDaOp('PMOC14', '8498')).toEqual([
      { posto: 'Inspeção AOI TOP', codigo: 'PRT410', compelsOp: '8500', apontadas: 2, naFila: 3, motivo: 'E-velho' },
      { posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: null, apontadas: 0, naFila: 0, motivo: null },
    ])
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('sf_resumo_trechos_op', { p_pmo: 'PMOC14', p_op: '8498' })
  })

  it('erro do banco sobe', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'sem permissão' } })
    await expect(resumoTrechosDaOp('PMOC14', '8498')).rejects.toThrow('sem permissão')
  })
})

describe('listarTrechosDaOp', () => {
  it('trechos na ordem, cada um com os seus postos na ordem da rota', async () => {
    consulta.select.mockReturnValue(consulta)
    consulta.eq.mockReturnValue(consulta)
    consulta.maybeSingle.mockResolvedValue({ data: {
      sf_ordem_trechos: [{ seq: 2, codigo: 'PMOC14', tipo: 'pmo', compels_op: '8498' }, { seq: 1, codigo: 'PRT410', tipo: 'prt', compels_op: '8500' }],
      sf_ordem_postos: [{ posto: 'Teste', ordem: 2, trecho_seq: 2 }, { posto: 'SPI', ordem: 0, trecho_seq: 1 }, { posto: 'AOI', ordem: 1, trecho_seq: 1 }],
    }, error: null })
    expect(await listarTrechosDaOp('PMOC14', '8498')).toEqual([
      { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI', 'AOI'] },
      { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', postos: ['Teste'] },
    ])
  })
  it('OP inexistente ou sem trechos = vazio', async () => {
    consulta.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await listarTrechosDaOp('X', '1')).toEqual([])
  })
})
