import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { ConferenciaLegado, EtiquetaLegadoEmitida } from '../domain/partnumber-legado'

/**
 * Acesso a dado das etiquetas do estoque legado (migração 0126). Tudo passa pelas funções
 * `etq_legado_*` (security definer): é o BANCO que atribui o sequencial, numa transação só, e o
 * índice único de (item, sequencial) é a garantia de que dois rolos nunca recebem o mesmo código.
 * A tabela não tem policy de insert — não existe caminho para gravar por fora.
 */

/** Par (item, locação) enviado ao banco: é tudo o que sai do navegador (a planilha não sobe). */
export interface ParLegado {
  item: string
  locacao: string
}

interface ConferenciaRpc {
  item: string
  locacao: string
  emitidas_na_locacao: number
  ultima_na_locacao: string | null
  ultimo_sequencial: number
}

interface EmitidaRpc {
  ordem: number
  item: string
  sequencial: number
  codigo: string
  locacao: string
}

export interface ResumoLegado {
  totalEtiquetas: number
  totalItens: number
  /** Data da última emissão (ISO), ou null se nada foi etiquetado ainda. */
  ultima: string | null
}

/** O que já foi etiquetado para os pares da planilha (prévia): repetição, data e onde o contador está. */
export async function conferirParesLegado(pares: ParLegado[]): Promise<ConferenciaLegado[]> {
  if (pares.length === 0) return []

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('etq_legado_conferir', { p_linhas: pares })
  if (error) throw error

  return ((data ?? []) as ConferenciaRpc[]).map((c) => ({
    item: c.item,
    locacao: c.locacao,
    emitidasNaLocacao: Number(c.emitidas_na_locacao ?? 0),
    ultimaNaLocacao: c.ultima_na_locacao,
    ultimoSequencial: Number(c.ultimo_sequencial ?? 0),
  }))
}

/**
 * Emite as etiquetas: grava uma linha por rolo e devolve o sequencial que cada uma recebeu, com a
 * `ordem` em que foi enviada (a ordem da planilha, que é a ordem em que as etiquetas serão coladas).
 */
export async function emitirEtiquetasLegado(pares: ParLegado[]): Promise<EtiquetaLegadoEmitida[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('etq_legado_emitir', { p_linhas: pares })
  if (error) throw error

  return ((data ?? []) as EmitidaRpc[]).map((e) => ({
    ordem: Number(e.ordem),
    item: e.item,
    sequencial: Number(e.sequencial),
    codigo: e.codigo,
    locacao: e.locacao,
  }))
}

/** Progresso do mutirão: quanto do estoque antigo já foi etiquetado. */
export async function resumoLegado(): Promise<ResumoLegado> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('etq_legado_resumo')
  if (error) throw error

  const linha = ((data ?? []) as { total_etiquetas: number; total_itens: number; ultima: string | null }[])[0]
  return {
    totalEtiquetas: Number(linha?.total_etiquetas ?? 0),
    totalItens: Number(linha?.total_itens ?? 0),
    ultima: linha?.ultima ?? null,
  }
}
