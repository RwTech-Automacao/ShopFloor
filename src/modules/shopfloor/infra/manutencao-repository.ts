import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { ReprovaRow, ReparoRow } from '../domain/manutencao-pendencias'

const POSTOS_ORIGEM = ['Teste', 'Burn-in', 'Teste Final']

export async function listarReprovasOrigem(): Promise<ReprovaRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('data_hora,cliente,pmo,op,numero_serie,numero_serie_norm,posto,codigo_defeito,posicao,tipo_defeito')
    .in('posto', POSTOS_ORIGEM)
    .eq('status', 'Reprovado')
    .order('data_hora', { ascending: false })
  if (error) throw error
  return (data as {
    data_hora: string
    cliente: string
    pmo: string
    op: string
    numero_serie: string
    numero_serie_norm: string
    posto: string
    codigo_defeito: string
    posicao: string
    tipo_defeito: string
  }[]).map((r) => ({
    dataHora: r.data_hora,
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    sn: r.numero_serie,
    snNorm: r.numero_serie_norm,
    posto: r.posto,
    cod: r.codigo_defeito,
    pos: r.posicao,
    tipo: r.tipo_defeito,
  }))
}

export async function listarReparos(): Promise<ReparoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('pmo,op,numero_serie_norm,posto_origem,data_hora_origem')
    .eq('posto', 'Manutenção')
  if (error) throw error
  return (data as {
    pmo: string
    op: string
    numero_serie_norm: string
    posto_origem: string
    data_hora_origem: string | null
  }[]).map((r) => ({
    pmo: r.pmo,
    op: r.op,
    snNorm: r.numero_serie_norm,
    postoOrigem: r.posto_origem,
    dataHoraOrigem: r.data_hora_origem,
  }))
}

export interface SfRegistrarReparoArgs {
  p_colaborador: string
  p_pmo: string
  p_op: string
  p_cliente: string
  p_sn: string
  p_sn_norm: string
  p_cod: string
  p_pos: string
  p_tipo: string
  p_posto_origem: string
  p_data_hora_origem: string
  p_consertos: { descricao: string; posicao: string }[]
}

export async function chamarSfRegistrarReparo(
  args: SfRegistrarReparoArgs,
): Promise<{ ok: boolean; erro?: string; linhas?: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_registrar_reparo', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; linhas?: number }
}
