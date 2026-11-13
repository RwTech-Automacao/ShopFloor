import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { resumoTrechosDaOp } from '../estrutura-repository'

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
