import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { DadosDashboard, FiltrosDashboard, OpcoesDashboard } from '../domain/dashboard'

/** O jsonb que a `rec_dashboard` (0152) devolve, em snake_case. */
interface DashboardRpc {
  totais: {
    itens: number
    com_divergencia: number
    sem_justificativa: number
    positivas: number
    negativas: number
    embs: number
    fora_do_recorte_por_data: number
  }
  fornecedores: { fornecedor: string; divergentes: number; itens: number }[]
  semanas: { inicio: string; justificadas: number; sem_justificativa: number }[]
}

interface OpcoesRpc {
  fornecedores: string[] | null
  compradores: string[] | null
}

/**
 * Tudo da tela numa chamada só: a `rec_dashboard` filtra, conta, ranqueia e monta a série no banco.
 * Texto vazio = sem filtro (o banco entende assim); data vazia vai como null (sem recorte).
 */
export async function carregarDashboard(filtros: FiltrosDashboard): Promise<DadosDashboard> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('rec_dashboard', {
    p_fornecedor: filtros.fornecedor,
    p_comprador: filtros.comprador,
    p_emb: filtros.emb,
    p_codigo: filtros.codigo,
    p_de: filtros.de || null,
    p_ate: filtros.ate || null,
    p_sinal: filtros.sinal,
  })
  if (error) throw error
  const r = data as DashboardRpc
  return {
    totais: {
      itens: Number(r.totais.itens),
      comDivergencia: Number(r.totais.com_divergencia),
      semJustificativa: Number(r.totais.sem_justificativa),
      positivas: Number(r.totais.positivas),
      negativas: Number(r.totais.negativas),
      embs: Number(r.totais.embs),
      foraDoRecortePorData: Number(r.totais.fora_do_recorte_por_data),
    },
    fornecedores: (r.fornecedores ?? []).map((f) => ({
      fornecedor: f.fornecedor ?? '',
      divergentes: Number(f.divergentes),
      itens: Number(f.itens),
    })),
    semanas: (r.semanas ?? []).map((s) => ({
      inicio: s.inicio,
      justificadas: Number(s.justificadas),
      semJustificativa: Number(s.sem_justificativa),
    })),
  }
}

/** Fornecedores e compradores distintos, para as duas listas suspensas (`rec_dashboard_opcoes`). */
export async function carregarOpcoesDashboard(): Promise<OpcoesDashboard> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('rec_dashboard_opcoes')
  if (error) throw error
  const r = (data ?? {}) as OpcoesRpc
  return { fornecedores: r.fornecedores ?? [], compradores: r.compradores ?? [] }
}
