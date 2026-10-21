import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { FiltrosDashboard } from '../domain/dashboard'
import type { MetricasDashboard } from '../domain/dashboard-metricas'

/** O jsonb que a `rec_dashboard_metricas` (0154) devolve, em snake_case. */
interface MetricasRpc {
  volume: {
    semanas: { inicio: string; itens: number; embs: number }[]
    meses: { inicio: string; itens: number; embs: number }[]
  }
  qualidade: {
    totais: { com_resultado: number; reprovados: number; pecas_recebidas: number; pecas_reprovadas: number }
    fornecedores: { fornecedor: string; com_resultado: number; reprovados: number }[]
    materiais: { codigo: string; descricao: string; com_resultado: number; reprovados: number }[]
    motivos: { motivo: string; itens: number }[]
  }
  atraso: {
    totais: { com_prazo: number; atrasados: number; media_dias_atraso: number | null }
    fornecedores: { fornecedor: string; com_prazo: number; atrasados: number; media_dias: number | null }[]
  }
  tempo: {
    recebimento: { n: number; media_dias: number | null; mediana_dias: number | null }
    qualidade: { n: number; media_dias: number | null; mediana_dias: number | null }
    parados: { dias: number; recebimento: number; qualidade: number }
    sem_tempo: number
  }
  pendencias: {
    total: number
    faixas: { no_prazo: number; d1_7: number; d8_30: number; d30_mais: number; sem_prevista: number }
    fornecedores: { fornecedor: string; pendentes: number; atrasados: number }[]
  }
}

/** Número que pode ser nulo: null permanece null (sem base não vira zero). */
function ouNulo(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v)
}

function tempo(t: MetricasRpc['tempo']['recebimento']) {
  return { n: Number(t.n), mediaDias: ouNulo(t.media_dias), medianaDias: ouNulo(t.mediana_dias) }
}

/**
 * Todas as métricas numa chamada só (`rec_dashboard_metricas`). Texto vazio = sem filtro; data vazia
 * vai como null. Erro ou resposta vazia LANÇA: nunca devolve zeros no lugar de uma falha.
 */
export async function carregarMetricas(
  filtros: FiltrosDashboard,
  paradoDias: number,
): Promise<MetricasDashboard> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('rec_dashboard_metricas', {
    p_fornecedor: filtros.fornecedor,
    p_comprador: filtros.comprador,
    p_emb: filtros.emb,
    p_codigo: filtros.codigo,
    p_de: filtros.de || null,
    p_ate: filtros.ate || null,
    p_parado_dias: paradoDias,
  })
  if (error) throw error
  if (data === null || data === undefined) throw new Error('rec_dashboard_metricas não devolveu dados')
  const r = data as MetricasRpc
  const periodo = (p: { inicio: string; itens: number; embs: number }) => ({
    inicio: p.inicio, itens: Number(p.itens), embs: Number(p.embs),
  })
  return {
    volume: {
      semanas: (r.volume?.semanas ?? []).map(periodo),
      meses: (r.volume?.meses ?? []).map(periodo),
    },
    qualidade: {
      totais: {
        comResultado: Number(r.qualidade.totais.com_resultado),
        reprovados: Number(r.qualidade.totais.reprovados),
        pecasRecebidas: Number(r.qualidade.totais.pecas_recebidas),
        pecasReprovadas: Number(r.qualidade.totais.pecas_reprovadas),
      },
      fornecedores: (r.qualidade.fornecedores ?? []).map((f) => ({
        fornecedor: f.fornecedor ?? '',
        comResultado: Number(f.com_resultado),
        reprovados: Number(f.reprovados),
      })),
      materiais: (r.qualidade.materiais ?? []).map((m) => ({
        codigo: m.codigo ?? '',
        descricao: m.descricao ?? '',
        comResultado: Number(m.com_resultado),
        reprovados: Number(m.reprovados),
      })),
      motivos: (r.qualidade.motivos ?? []).map((m) => ({ motivo: m.motivo ?? '', itens: Number(m.itens) })),
    },
    atraso: {
      totais: {
        comPrazo: Number(r.atraso.totais.com_prazo),
        atrasados: Number(r.atraso.totais.atrasados),
        mediaDiasAtraso: ouNulo(r.atraso.totais.media_dias_atraso),
      },
      fornecedores: (r.atraso.fornecedores ?? []).map((f) => ({
        fornecedor: f.fornecedor ?? '',
        comPrazo: Number(f.com_prazo),
        atrasados: Number(f.atrasados),
        mediaDias: ouNulo(f.media_dias),
      })),
    },
    tempo: {
      recebimento: tempo(r.tempo.recebimento),
      qualidade: tempo(r.tempo.qualidade),
      parados: {
        dias: Number(r.tempo.parados.dias),
        recebimento: Number(r.tempo.parados.recebimento),
        qualidade: Number(r.tempo.parados.qualidade),
      },
      semTempo: Number(r.tempo.sem_tempo),
    },
    pendencias: {
      total: Number(r.pendencias.total),
      faixas: {
        noPrazo: Number(r.pendencias.faixas.no_prazo),
        d1a7: Number(r.pendencias.faixas.d1_7),
        d8a30: Number(r.pendencias.faixas.d8_30),
        d30mais: Number(r.pendencias.faixas.d30_mais),
        semPrevista: Number(r.pendencias.faixas.sem_prevista),
      },
      fornecedores: (r.pendencias.fornecedores ?? []).map((f) => ({
        fornecedor: f.fornecedor ?? '',
        pendentes: Number(f.pendentes),
        atrasados: Number(f.atrasados),
      })),
    },
  }
}
