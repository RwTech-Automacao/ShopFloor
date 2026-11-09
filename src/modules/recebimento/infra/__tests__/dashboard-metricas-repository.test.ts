import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ rpc }),
}))

import { carregarMetricas } from '../dashboard-metricas-repository'
import { FILTROS_LIMPOS } from '../../domain/dashboard'

beforeEach(() => rpc.mockReset())

const JSONB = {
  volume: {
    semanas: [{ inicio: '2026-09-07', itens: '12', embs: 3 }],
    meses: [{ inicio: '2026-09-01', itens: 40, embs: 9 }],
  },
  qualidade: {
    totais: { com_resultado: 100, reprovados: 4, pecas_recebidas: 52000, pecas_reprovadas: 380 },
    fornecedores: [{ fornecedor: 'ACME', com_resultado: 20, reprovados: 3 }],
    materiais: [{ codigo: 'RWPC99', descricao: 'Capacitor', com_resultado: 8, reprovados: 2 }],
    motivos: [{ motivo: 'Fora de especificação', itens: 3 }],
  },
  atraso: {
    totais: { com_prazo: 90, atrasados: 30, media_dias_atraso: 4.5 },
    fornecedores: [{ fornecedor: 'ACME', com_prazo: 10, atrasados: 6, media_dias: 5.2 }],
  },
  tempo: {
    recebimento: { n: 70, media_dias: 1.8, mediana_dias: 1.0 },
    qualidade: { n: 0, media_dias: null, mediana_dias: null },
    parados: { dias: 7, recebimento: 4, qualidade: 9 },
    sem_tempo: 12,
  },
  pendencias: {
    total: 229,
    faixas: { no_prazo: 100, d1_7: 40, d8_30: 50, d30_mais: 30, sem_prevista: 9 },
    fornecedores: [{ fornecedor: '', pendentes: 12, atrasados: 8 }],
  },
}

describe('carregarMetricas', () => {
  it('manda os filtros e o X: texto vazio = sem filtro, data vazia = null', async () => {
    rpc.mockResolvedValue({ data: JSONB, error: null })
    await carregarMetricas({ ...FILTROS_LIMPOS, emb: 'EMB2', de: '2026-09-01', sinal: 'positiva' }, 15)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('rec_dashboard_metricas', {
      p_fornecedor: '', p_comprador: '', p_emb: 'EMB2', p_codigo: '',
      p_de: '2026-09-01', p_ate: null, p_parado_dias: 15,
    })
  })

  it('traduz o jsonb para camelCase e número; null de média permanece null', async () => {
    rpc.mockResolvedValue({ data: JSONB, error: null })
    const m = await carregarMetricas(FILTROS_LIMPOS, 7)
    expect(m.volume.semanas).toEqual([{ inicio: '2026-09-07', itens: 12, embs: 3 }])
    expect(m.qualidade.totais).toEqual({ comResultado: 100, reprovados: 4, pecasRecebidas: 52000, pecasReprovadas: 380 })
    expect(m.qualidade.materiais[0]).toEqual({ codigo: 'RWPC99', descricao: 'Capacitor', comResultado: 8, reprovados: 2 })
    expect(m.qualidade.motivos).toEqual([{ motivo: 'Fora de especificação', itens: 3 }])
    expect(m.atraso.totais).toEqual({ comPrazo: 90, atrasados: 30, mediaDiasAtraso: 4.5 })
    expect(m.atraso.fornecedores[0]).toEqual({ fornecedor: 'ACME', comPrazo: 10, atrasados: 6, mediaDias: 5.2 })
    expect(m.tempo.recebimento).toEqual({ n: 70, mediaDias: 1.8, medianaDias: 1 })
    expect(m.tempo.qualidade).toEqual({ n: 0, mediaDias: null, medianaDias: null })
    expect(m.tempo.parados).toEqual({ dias: 7, recebimento: 4, qualidade: 9 })
    expect(m.tempo.semTempo).toBe(12)
    expect(m.pendencias.total).toBe(229)
    expect(m.pendencias.faixas).toEqual({ noPrazo: 100, d1a7: 40, d8a30: 50, d30mais: 30, semPrevista: 9 })
    expect(m.pendencias.fornecedores).toEqual([{ fornecedor: '', pendentes: 12, atrasados: 8 }])
  })

  it('média nula do atraso permanece null', async () => {
    rpc.mockResolvedValue({
      data: { ...JSONB, atraso: { totais: { com_prazo: 0, atrasados: 0, media_dias_atraso: null }, fornecedores: [] } },
      error: null,
    })
    expect((await carregarMetricas(FILTROS_LIMPOS, 7)).atraso.totais.mediaDiasAtraso).toBeNull()
  })

  it('erro do banco sobe', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'SEM_PERMISSAO' } })
    await expect(carregarMetricas(FILTROS_LIMPOS, 7)).rejects.toEqual({ message: 'SEM_PERMISSAO' })
  })

  it('data nulo SEM erro lança, nunca zeros', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(carregarMetricas(FILTROS_LIMPOS, 7)).rejects.toThrow(/rec_dashboard_metricas/)
  })
})
