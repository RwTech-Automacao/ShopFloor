import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ rpc }),
}))

import { carregarDashboard, carregarOpcoesDashboard } from '../dashboard-repository'
import { FILTROS_LIMPOS } from '../../domain/dashboard'

beforeEach(() => rpc.mockReset())

describe('carregarDashboard', () => {
  it('manda os filtros como a rec_dashboard espera: texto vazio = sem filtro, data vazia = null', async () => {
    rpc.mockResolvedValue({
      data: {
        totais: { itens: 0, com_divergencia: 0, sem_justificativa: 0, positivas: 0, negativas: 0, embs: 0, fora_do_recorte_por_data: 0 },
        fornecedores: [], semanas: [],
      },
      error: null,
    })
    await carregarDashboard({ ...FILTROS_LIMPOS, emb: 'EMB2', de: '2026-09-01', sinal: 'positiva' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('rec_dashboard', {
      p_fornecedor: '', p_comprador: '', p_emb: 'EMB2', p_codigo: '',
      p_de: '2026-09-01', p_ate: null, p_sinal: 'positiva',
    })
  })

  it('traduz o jsonb para camelCase e número', async () => {
    rpc.mockResolvedValue({
      data: {
        totais: { itens: 9, com_divergencia: 6, sem_justificativa: 4, positivas: 3, negativas: 3, embs: 4, fora_do_recorte_por_data: 1 },
        fornecedores: [{ fornecedor: '', divergentes: 1, itens: 1 }],
        semanas: [{ inicio: '2026-09-14', justificadas: 0, sem_justificativa: 0 }],
      },
      error: null,
    })
    expect(await carregarDashboard(FILTROS_LIMPOS)).toEqual({
      totais: { itens: 9, comDivergencia: 6, semJustificativa: 4, positivas: 3, negativas: 3, embs: 4, foraDoRecortePorData: 1 },
      fornecedores: [{ fornecedor: '', divergentes: 1, itens: 1 }],
      semanas: [{ inicio: '2026-09-14', justificadas: 0, semJustificativa: 0 }],
    })
  })

  it('erro do banco sobe (a página decide o que mostrar)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'SEM_PERMISSAO' } })
    await expect(carregarDashboard(FILTROS_LIMPOS)).rejects.toEqual({ message: 'SEM_PERMISSAO' })
  })

  it('data nulo SEM erro lança erro explícito, nunca um dashboard vazio', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(carregarDashboard(FILTROS_LIMPOS)).rejects.toThrow(/rec_dashboard/)
  })
})

describe('carregarOpcoesDashboard', () => {
  it('erro do banco sobe', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'SEM_PERMISSAO' } })
    await expect(carregarOpcoesDashboard()).rejects.toEqual({ message: 'SEM_PERMISSAO' })
  })

  it('devolve as duas listas, vazias quando o banco não tem nada', async () => {
    rpc.mockResolvedValue({ data: { fornecedores: ['ACME', 'Vishay'], compradores: null }, error: null })
    expect(await carregarOpcoesDashboard()).toEqual({ fornecedores: ['ACME', 'Vishay'], compradores: [] })
    expect(rpc).toHaveBeenCalledWith('rec_dashboard_opcoes')
  })
})
