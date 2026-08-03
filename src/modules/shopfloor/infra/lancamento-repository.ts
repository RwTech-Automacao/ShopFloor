import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { agruparReceitaPorPosto, type ReceitaPorPosto } from '@/modules/shopfloor/domain/receita-posto'
import { agruparTempoBurninPorPosto, type TempoBurninPorPosto } from '@/modules/shopfloor/domain/burnin-posto'

export interface OrdemLancamento {
  cliente: string
  descricao: string
  qtd: number | null
  sn_ini: string
  sn_fim: string
  postos: string[]
}

export interface SfLancarArgs {
  p_pmo: string
  p_op: string
  p_cliente: string
  p_posto: string
  p_colaborador: string
  p_numero_serie: string
  p_numero_serie_norm: string
  p_status: string
  p_posto_tem_status: boolean
  p_numero_caixa: string
  p_qtd_por_caixa: number | null
  p_nqa_visual: string
  p_nqa_funcional: string
  p_prev_posto: string
  p_prev_precisa_aprovado: boolean
  p_linhas: { codigo_defeito: string; posicao: string; tipo_defeito: string }[]
  p_exige_manutencao: boolean
}

/** Clientes distintos das OPs ativas (status ≠ FINALIZADA). */
export async function listarClientes(): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente')
    .neq('status', 'FINALIZADA')
    .order('cliente')
  if (error) throw error
  return [...new Set((data as { cliente: string }[]).map((r) => r.cliente).filter(Boolean))]
}

export async function listarPmos(cliente: string): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo')
    .eq('cliente', cliente)
    .neq('status', 'FINALIZADA')
    .order('pmo')
  if (error) throw error
  return [...new Set((data as { pmo: string }[]).map((r) => r.pmo).filter(Boolean))]
}

export async function listarOps(cliente: string, pmo: string): Promise<{ op: string }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('op')
    .eq('cliente', cliente)
    .eq('pmo', pmo)
    .neq('status', 'FINALIZADA')
    .order('op')
  if (error) throw error
  return data as { op: string }[]
}

export async function carregarOrdem(pmo: string, op: string): Promise<OrdemLancamento | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente,descricao,qtd,sn_ini,sn_fim,sf_ordem_postos(posto,ordem)')
    .eq('pmo', pmo)
    .eq('op', op)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as {
    cliente: string
    descricao: string
    qtd: number | null
    sn_ini: string
    sn_fim: string
    sf_ordem_postos: { posto: string; ordem: number }[]
  }
  return {
    cliente: row.cliente,
    descricao: row.descricao,
    qtd: row.qtd,
    sn_ini: row.sn_ini,
    sn_fim: row.sn_fim,
    // postos NA ORDEM da OP (a sequência importa p/ a trava de sequência).
    postos: [...row.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
  }
}

export async function listarDefeitos(): Promise<{ codigo: string; tipo: number }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_defeitos').select('codigo,tipo').order('codigo')
  if (error) throw error
  return data as { codigo: string; tipo: number }[]
}

/** Chama a função atômica sf_lancar. Erros de infra viram { ok:false, erro:'ERRO_INTERNO' }. */
export async function chamarSfLancar(
  args: SfLancarArgs,
): Promise<{ ok: boolean; erro?: string; caixa_count?: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_lancar', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; caixa_count?: number }
}

export interface OrdemLancamentoLista {
  cliente: string
  pmo: string
  op: string
  descricao: string
  qtd: number | null
  sn_ini: string
  sn_fim: string
  postos: string[]
  receitaPorPosto: ReceitaPorPosto
  tempoBurninPorPosto: TempoBurninPorPosto
}

/** Todas as OPs ativas com config + fluxo ordenado, para a cascata da tela de Lançamento. */
export async function listarOrdensParaLancamento(): Promise<OrdemLancamentoLista[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select(
      'cliente,pmo,op,descricao,qtd,sn_ini,sn_fim,sf_ordem_postos(posto,ordem),sf_ordem_componentes(posto,pmo_componente),sf_ordem_burnin(posto,tempo_min)',
    )
    .neq('status', 'FINALIZADA')
    .order('cliente')
    .order('pmo')
    .order('op')
  if (error) throw error
  const rows = data as unknown as {
    cliente: string
    pmo: string
    op: string
    descricao: string
    qtd: number | null
    sn_ini: string
    sn_fim: string
    sf_ordem_postos: { posto: string; ordem: number }[]
    sf_ordem_componentes: { posto: string; pmo_componente: string }[]
    sf_ordem_burnin: { posto: string; tempo_min: number }[]
  }[]
  return rows.map((r) => ({
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    descricao: r.descricao,
    qtd: r.qtd,
    sn_ini: r.sn_ini,
    sn_fim: r.sn_fim,
    postos: [...r.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
    receitaPorPosto: agruparReceitaPorPosto(r.sf_ordem_componentes),
    tempoBurninPorPosto: agruparTempoBurninPorPosto(r.sf_ordem_burnin),
  }))
}

export interface OrdemIntegracao {
  cliente: string
  pmo: string
  op: string
  descricao: string
  sn_ini: string
  sn_fim: string
  qtd: number | null
  status: string
  postos: string[]
  componentes: string[]
  concluidas: number
}

/** TODAS as OPs (ativas + finalizadas) enriquecidas p/ a tela de Integração. */
export async function listarOrdensParaIntegracao(): Promise<OrdemIntegracao[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente,pmo,op,descricao,sn_ini,sn_fim,qtd,status,sf_ordem_postos(posto,ordem),sf_ordem_componentes(pmo_componente)')
    .order('cliente')
    .order('pmo')
    .order('op')
  if (error) throw error
  const rows = data as unknown as {
    cliente: string
    pmo: string
    op: string
    descricao: string
    sn_ini: string
    sn_fim: string
    qtd: number | null
    status: string
    sf_ordem_postos: { posto: string; ordem: number }[]
    sf_ordem_componentes: { pmo_componente: string }[]
  }[]
  const resumo = await supabase.from('sf_ordem_resumo').select('pmo,op,concluidas')
  if (resumo.error) throw resumo.error
  const mapa = new Map<string, number>()
  for (const r of resumo.data as { pmo: string; op: string; concluidas: number }[]) {
    mapa.set(`${r.pmo}||${r.op}`, r.concluidas)
  }
  return rows.map((r) => ({
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    descricao: r.descricao,
    sn_ini: r.sn_ini,
    sn_fim: r.sn_fim,
    qtd: r.qtd,
    status: r.status,
    postos: [...r.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
    componentes: r.sf_ordem_componentes.map((c) => c.pmo_componente),
    concluidas: mapa.get(`${r.pmo}||${r.op}`) ?? 0,
  }))
}

/** Faixas de SN de todas as OPs (p/ a verificação N1 do SN da placa). */
export async function listarFaixasOrdens(): Promise<{ pmo: string; op: string; sn_ini: string; sn_fim: string }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').select('pmo,op,sn_ini,sn_fim')
  if (error) throw error
  return data as { pmo: string; op: string; sn_ini: string; sn_fim: string }[]
}

export interface SfBurninArgs {
  p_evento: 'entrada' | 'saida'
  p_pmo: string
  p_op: string
  p_cliente: string
  p_colaborador: string
  p_sn: string
  p_sn_norm: string
  p_status: string
  p_prev_posto: string
  p_prev_precisa_aprovado: boolean
  p_exige_manutencao: boolean
  p_linhas: { codigo_defeito: string; posicao: string; tipo_defeito: string }[]
  p_posto: string
}

export async function chamarSfBurnin(
  args: SfBurninArgs,
): Promise<{ ok: boolean; erro?: string; evento?: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_burnin', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; evento?: string }
}

/** data_hora (ISO) da ENTRADA de Burn-in aberta da peça NESTE POSTO; null se não houver entrada aberta. */
export async function buscarEntradaBurninAberta(pmo: string, op: string, snNorm: string, posto: string): Promise<string | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('status,data_hora')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', snNorm).eq('posto', posto)
    .order('data_hora', { ascending: false })
    .limit(1)
  if (error) throw error
  const linha = (data ?? [])[0] as { status: string; data_hora: string } | undefined
  if (!linha || linha.status !== '') return null // sem entrada aberta (último evento não é entrada)
  return linha.data_hora
}
