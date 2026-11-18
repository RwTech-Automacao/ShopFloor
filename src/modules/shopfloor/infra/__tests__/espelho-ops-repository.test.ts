import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const consulta = vi.hoisted(() => ({ select: vi.fn(), order: vi.fn() }))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ from: () => consulta }) }))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { gravarEspelhoDoServico, listarEspelho } from '../espelho-ops-repository'

describe('espelho-ops-repository', () => {
  it('grava pela sf_compels_ops_sincronizar com as chaves do banco', async () => {
    const rpc = vi.fn(async () => ({ data: { novas: 1, atualizadas: 0, inativadas: 0 }, error: null }))
    const gravar = gravarEspelhoDoServico({ rpc } as never)
    const r = await gravar([{ numero: 8498, idCompels: 1, codigo: 'PMOC14', descricao: 'X', situacao: 'Aberta', nivel: 1, quantidade: 10, quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente: 'C', dataDocumento: '2026-11-10' }])
    expect(r).toEqual({ novas: 1, atualizadas: 0, inativadas: 0 })
    expect(rpc).toHaveBeenCalledWith('sf_compels_ops_sincronizar', { p_ops: [{
      numero: 8498, id_compels: 1, codigo: 'PMOC14', descricao: 'X', situacao: 'Aberta', nivel: 1, quantidade: 10,
      quantidade_produzida: 0, mae_numero: null, principal_numero: null, cliente: 'C', data_documento: '2026-11-10',
    }] })
  })
  it('lista o espelho convertido', async () => {
    consulta.select.mockReturnValue(consulta)
    consulta.order.mockResolvedValue({ data: [{ numero: 8498, id_compels: 1, codigo: 'PMOC14', descricao: 'X', situacao: 'Aberta', nivel: 1, quantidade: '10', quantidade_produzida: '0', mae_numero: null, principal_numero: null, cliente: 'C', data_documento: '2026-11-10', ativa: true, lido_em: '2026-11-18T13:00:00Z' }], error: null })
    expect(await listarEspelho()).toEqual([{ numero: 8498, idCompels: 1, codigo: 'PMOC14', descricao: 'X', situacao: 'Aberta', nivel: 1, quantidade: 10, quantidadeProduzida: 0, maeNumero: null, principalNumero: null, cliente: 'C', dataDocumento: '2026-11-10', ativa: true, lidoEm: '2026-11-18T13:00:00Z' }])
  })
})
