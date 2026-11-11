import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { faixasDoBanco, type FaixaSN } from '@/modules/shopfloor/domain/faixas-sn'

export interface PostoRow {
  chave: string
  ordem: number
  perfil: string
  coletivo: boolean
  /** Postos que a peça repassa depois da Manutenção antes de voltar a ESTE posto. '' = volta direto. */
  retorno_pos_manutencao: string
}

export interface OrdemRow {
  id: string
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  sn_ini: string
  sn_fim: string
  embalagem_individual: boolean
  placas_por_painel: number
  created_at: string
  sf_ordem_postos: { posto: string; ordem: number }[]
  sf_ordem_componentes: { posto: string; pmo_componente: string }[]
  sf_ordem_burnin: { posto: string; tempo_min: number }[]
  /** Faixas de SN (0181); ausente/vazio = só sn_ini/sn_fim. */
  sf_ordem_faixas?: { seq: number; sn_ini: string; sn_fim: string }[] | null
}

export interface DadosOrdem {
  pmo: string
  op: string
  cliente: string
  qtd: number | null
  descricao: string
  acp: string
  status: string
  /** A PRIMEIRA faixa de SN (0181): a lista inteira vai para sf_ordem_faixas (gravarFaixas). */
  sn_ini: string
  sn_fim: string
  embalagem_individual: boolean
  /** Placas que cada bipe de painel conta (0161). 1 = bipe por placa. */
  placas_por_painel: number
  /** Quem encerrou (0145). A tela só grava 'manual' ou null; 'rotina' é exclusivo da rotina SQL. */
  finalizada_por: 'manual' | null
  /**
   * Reativação na mão (0148). Só aparece no payload QUANDO a OP está sendo reativada, e só com
   * `true`: a marca é definitiva, então a tela nunca a apaga. Ausente = não mexe na coluna.
   */
  reaberta_manual?: true
}

export async function listarPostos(): Promise<PostoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_postos').select('chave,ordem,perfil,coletivo,retorno_pos_manutencao').order('ordem')
  if (error) throw error
  return data as PostoRow[]
}

export async function listarOrdens(): Promise<OrdemRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('id,pmo,op,cliente,qtd,descricao,acp,status,sn_ini,sn_fim,embalagem_individual,placas_por_painel,created_at,sf_ordem_postos(posto,ordem),sf_ordem_componentes(posto,pmo_componente),sf_ordem_burnin(posto,tempo_min),sf_ordem_faixas(seq,sn_ini,sn_fim)')
    .order('pmo')
    .order('op')
  if (error) throw error
  return data as unknown as OrdemRow[]
}

/**
 * Regrava a lista de faixas de SN da OP (apaga e reinsere, seq 1..N). Vem DEPOIS de gravar a OP: o
 * trigger da 0181 já pôs a faixa 1 (sn_ini/sn_fim) e aqui a lista inteira a substitui.
 */
async function gravarFaixas(supabase: Awaited<ReturnType<typeof createServerSupabase>>, id: string, faixas: FaixaSN[]): Promise<void> {
  const { error: eDel } = await supabase.from('sf_ordem_faixas').delete().eq('ordem_id', id)
  if (eDel) throw eDel
  if (faixas.length > 0) {
    const { error: eIns } = await supabase
      .from('sf_ordem_faixas')
      .insert(faixas.map((f, i) => ({ ordem_id: id, seq: i + 1, sn_ini: f.sn_ini, sn_fim: f.sn_fim })))
    if (eIns) throw eIns
  }
}

/** Insere a OP, a aplicabilidade, a receita e as faixas de SN; devolve o id. */
export async function criarOrdem(dados: DadosOrdem, postos: string[], receita: { posto: string; pmo: string }[], burnin: { posto: string; tempo_min: number }[], faixas: FaixaSN[]): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordens').insert(dados).select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id
  if (postos.length > 0) {
    const { error: e2 } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto, i) => ({ ordem_id: id, posto, ordem: i })))
    if (e2) throw e2
  }
  if (receita.length > 0) {
    const { error: e3 } = await supabase
      .from('sf_ordem_componentes')
      .insert(receita.map((r) => ({ ordem_id: id, posto: r.posto, pmo_componente: r.pmo })))
    if (e3) throw e3
  }
  if (burnin.length > 0) {
    const { error: e4 } = await supabase
      .from('sf_ordem_burnin')
      .insert(burnin.map((b) => ({ ordem_id: id, posto: b.posto, tempo_min: b.tempo_min })))
    if (e4) throw e4
  }
  await gravarFaixas(supabase, id, faixas)
  return id
}

/** Atualiza a OP e RESSINCRONIZA a aplicabilidade, a receita e as faixas de SN (apaga e reinsere). */
export async function atualizarOrdem(id: string, dados: DadosOrdem, postos: string[], receita: { posto: string; pmo: string }[], burnin: { posto: string; tempo_min: number }[], faixas: FaixaSN[]): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_ordens')
    .update({ ...dados, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  const { error: eDel } = await supabase.from('sf_ordem_postos').delete().eq('ordem_id', id)
  if (eDel) throw eDel
  if (postos.length > 0) {
    const { error: eIns } = await supabase
      .from('sf_ordem_postos')
      .insert(postos.map((posto, i) => ({ ordem_id: id, posto, ordem: i })))
    if (eIns) throw eIns
  }
  const { error: eDelC } = await supabase.from('sf_ordem_componentes').delete().eq('ordem_id', id)
  if (eDelC) throw eDelC
  if (receita.length > 0) {
    const { error: eInsC } = await supabase
      .from('sf_ordem_componentes')
      .insert(receita.map((r) => ({ ordem_id: id, posto: r.posto, pmo_componente: r.pmo })))
    if (eInsC) throw eInsC
  }
  const { error: eDelB } = await supabase.from('sf_ordem_burnin').delete().eq('ordem_id', id)
  if (eDelB) throw eDelB
  if (burnin.length > 0) {
    const { error: eInsB } = await supabase
      .from('sf_ordem_burnin')
      .insert(burnin.map((b) => ({ ordem_id: id, posto: b.posto, tempo_min: b.tempo_min })))
    if (eInsB) throw eInsB
  }
  await gravarFaixas(supabase, id, faixas)
}

export async function excluirOrdem(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_ordens').delete().eq('id', id)
  if (error) throw error
}

/** Quantos registros de lançamento existem para a OP (guarda de exclusão). */
export async function contarRegistros(pmo: string, op: string): Promise<number> {
  const supabase = await createServerSupabase()
  const { count, error } = await supabase
    .from('sf_registros')
    .select('*', { count: 'exact', head: true })
    .eq('pmo', pmo)
    .eq('op', op)
  if (error) throw error
  return count ?? 0
}

/** OP já usa esse número (em qualquer PMO)? Regra de OP única global. `excetoId` ignora a própria OP na edição. */
export async function buscarOpEmUso(op: string, excetoId?: string): Promise<{ id: string; pmo: string; op: string } | null> {
  const supabase = await createServerSupabase()
  let q = supabase.from('sf_ordens').select('id,pmo,op').eq('op', op).limit(1)
  if (excetoId) q = q.neq('id', excetoId)
  const { data, error } = await q
  if (error) throw error
  const row = data?.[0]
  return row ? (row as { id: string; pmo: string; op: string }) : null
}

export interface OrdemBase {
  pmo: string
  op: string
  status: string
  placas_por_painel: number
  sn_ini?: string
  sn_fim?: string
  /** Faixas de SN gravadas (0181), na ordem. */
  faixas?: FaixaSN[]
}

/**
 * PMO, OP, status, placas por painel e faixas de SN atuais da OP. O status vem para o editar saber se a
 * OP está sendo REATIVADA; o N, para a trava de edição com registros; as faixas, para o aviso de SNs que
 * ficariam fora das faixas novas.
 */
export async function buscarOrdemBase(id: string): Promise<OrdemBase | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo,op,status,placas_por_painel,sn_ini,sn_fim,sf_ordem_faixas(seq,sn_ini,sn_fim)')
    .eq('id', id)
    .single()
  if (error) return null
  const r = data as unknown as OrdemBase & { sf_ordem_faixas?: { seq: number; sn_ini: string; sn_fim: string }[] | null }
  return {
    pmo: r.pmo,
    op: r.op,
    status: r.status,
    placas_por_painel: r.placas_por_painel,
    sn_ini: r.sn_ini,
    sn_fim: r.sn_fim,
    faixas: faixasDoBanco(r.sf_ordem_faixas),
  }
}

/**
 * Quantos SNs distintos da OP (registros + integrações ativas) ficariam FORA das faixas dadas (0181,
 * sf_ordem_sns_fora_das_faixas). `faixas` null = todos (a OP vai trocar de PMO/OP). Erro lança.
 */
export async function contarSnsForaDasFaixas(pmo: string, op: string, faixas: FaixaSN[] | null): Promise<number> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_ordem_sns_fora_das_faixas', {
    p_pmo: pmo,
    p_op: op,
    p_faixas: faixas === null ? null : faixas.map((f) => ({ sn_ini: f.sn_ini, sn_fim: f.sn_fim })),
  })
  if (error) throw error
  return Number(data ?? 0)
}

/** Rota GRAVADA da OP (postos na ordem). É a base da trava do Almoxarifado na edição; erro de leitura lança (fail-closed). */
export async function listarRotaGravada(id: string): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_ordem_postos').select('posto,ordem').eq('ordem_id', id).order('ordem')
  if (error) throw error
  return ((data ?? []) as { posto: string }[]).map((r) => r.posto)
}
