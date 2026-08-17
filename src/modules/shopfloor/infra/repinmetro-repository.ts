import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'

/** Um teste do repinmetro espelhado (linha de `repinmetro_logs`). */
export interface LogRepinmetro {
  origemId: number
  numeroSerie: string
  modelo: string | null
  dataInicio: string | null
  dataFim: string | null
  status: string | null
  observacao: string | null
  remanufaturado: string | null
  lacre: string | null
  opCodigo: string | null
  opAno: string | null
  placaOp: string | null
  /** 15 itens de teste: chave = coluna de origem (ver ITENS_REPINMETRO), valor = APROVADO/REPROVADO/NA. */
  resultados: Record<string, string | null>
}

const COLUNAS =
  'origem_id,numero_serie,modelo,data_inicio,data_fim,status,observacao,remanufaturado,lacre,op_codigo,op_ano,placa_op,resultados'

type LinhaRaw = Record<string, unknown>
function mapear(r: LinhaRaw): LogRepinmetro {
  return {
    origemId: r.origem_id as number,
    numeroSerie: r.numero_serie as string,
    modelo: r.modelo as string | null,
    dataInicio: r.data_inicio as string | null,
    dataFim: r.data_fim as string | null,
    status: r.status as string | null,
    observacao: r.observacao as string | null,
    remanufaturado: r.remanufaturado as string | null,
    lacre: r.lacre as string | null,
    opCodigo: r.op_codigo as string | null,
    opAno: r.op_ano as string | null,
    placaOp: r.placa_op as string | null,
    resultados: (r.resultados ?? {}) as Record<string, string | null>,
  }
}

/**
 * Testes do repinmetro filtrados por Nº de Série e/ou Modelo (mais recente primeiro).
 * - SN casa pelo NORMALIZADO (sem zeros à esquerda) → "13976" acha "0013976".
 * - `modelo` vazio = todos os modelos; SN vazio = todos os SNs (limitado a `limite`, modo estudo).
 */
export async function buscarLogs(
  { sn, modelo, limite = 500 }: { sn: string; modelo: string; limite?: number },
): Promise<LogRepinmetro[]> {
  const supabase = await createServerSupabase()
  const snTrim = sn.trim()
  const modeloTrim = modelo.trim()
  let query = supabase.from('repinmetro_logs').select(COLUNAS)
  if (snTrim !== '') query = query.eq('numero_serie_norm', normalizarSerie(snTrim))
  if (modeloTrim !== '') query = query.eq('modelo', modeloTrim)
  query = query.order('data_inicio', { ascending: false }).order('origem_id', { ascending: false })
  if (snTrim === '') query = query.limit(limite) // sem SN = muitos → limita (estudo)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(mapear)
}

/** Modelos distintos (pro filtro suspenso). Via RPC (DISTINCT no servidor). */
export async function listarModelos(): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('repinmetro_modelos')
  if (error) throw error
  return ((data ?? []) as { modelo: string }[]).map((r) => r.modelo).filter(Boolean)
}
