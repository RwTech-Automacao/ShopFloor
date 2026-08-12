import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

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

/** Testes do repinmetro de um Nº de Série (mais recente primeiro). Match exato pelo SN espelhado. */
export async function buscarLogsPorSn(sn: string): Promise<LogRepinmetro[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('repinmetro_logs')
    .select(COLUNAS)
    .eq('numero_serie', sn.trim())
    .order('data_inicio', { ascending: false })
    .order('origem_id', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({
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
  }))
}
