import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
import { PECAS_REP, chaveRevenda, type PecaRep } from '@/modules/shopfloor/domain/repinmetro'

/** Revenda do REP (espelho da tela REPs/Revendas do sistema de chaves). */
export interface RevendaRepinmetro {
  nome: string | null
  saidaEm: string | null
}

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
  /** null = nenhum REP com esse modelo + nº de série no sistema de chaves. */
  revenda: RevendaRepinmetro | null
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
    revenda: null,
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
  const logs = (data ?? []).map(mapear)
  await anexarRevendas(supabase, logs)
  return logs
}

/**
 * Preenche `revenda` de cada teste, casando por modelo + nº de série normalizado. Uma consulta só,
 * pelos SNs da página. Se a tabela de revendas falhar (ex.: migração ainda não aplicada), os testes
 * aparecem sem revenda em vez de a busca inteira quebrar.
 */
async function anexarRevendas(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  logs: LogRepinmetro[],
): Promise<void> {
  const sns = [...new Set(logs.map((l) => normalizarSerie(l.numeroSerie)).filter(Boolean))]
  if (sns.length === 0) return
  const { data, error } = await supabase
    .from('repinmetro_revendas')
    .select('modelo,numero_serie_norm,revenda,saida_em')
    .in('numero_serie_norm', sns)
  if (error) return
  const porChave = new Map<string, RevendaRepinmetro>()
  for (const r of (data ?? []) as LinhaRaw[]) {
    const chave = chaveRevenda(r.modelo as string, r.numero_serie_norm as string)
    if (chave) porChave.set(chave, { nome: r.revenda as string | null, saidaEm: r.saida_em as string | null })
  }
  for (const log of logs) {
    const chave = chaveRevenda(log.modelo, log.numeroSerie)
    log.revenda = (chave && porChave.get(chave)) || null
  }
}

/** Modelos distintos (pro filtro suspenso). Via RPC (DISTINCT no servidor). */
export async function listarModelos(): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('repinmetro_modelos')
  if (error) throw error
  return ((data ?? []) as { modelo: string }[]).map((r) => r.modelo).filter(Boolean)
}

/** Um teste de produção do repinmetro: o REP e os seriais das peças montadas nele. */
export interface IntegracaoRep {
  origemId: number
  numeroSerie: string
  modelo: string | null
  dataInicio: string | null
  dataFim: string | null
  status: string | null
  observacao: string | null
  seriais: Record<PecaRep['chave'], string | null>
}

const COLUNAS_PRODUCAO =
  'origem_id,numero_serie,modelo,data_inicio,data_fim,status,observacao,' + PECAS_REP.map((p) => p.chave).join(',')

/**
 * Testes de produção (integração do REP), mais recente primeiro.
 * - `por: 'rep'`: pelo nº de série do produto final (normalizado) e, se informado, pelo modelo.
 * - `por: 'peca'`: pelo serial de qualquer peça montada (normalizado, sem traços nem zeros à esquerda).
 */
export async function buscarIntegracoesRep(
  { por, termo, modelo, limite = 200 }: { por: 'rep' | 'peca'; termo: string; modelo: string; limite?: number },
): Promise<IntegracaoRep[]> {
  const alvo = normalizarSerie(termo)
  if (!alvo) return []
  const supabase = await createServerSupabase()
  let query = supabase.from('repinmetro_producao').select(COLUNAS_PRODUCAO)
  if (por === 'rep') {
    query = query.eq('numero_serie_norm', alvo)
    if (modelo.trim() !== '') query = query.eq('modelo', modelo.trim())
  } else {
    query = query.contains('seriais_norm', [alvo])
  }
  const { data, error } = await query
    .order('data_inicio', { ascending: false })
    .order('origem_id', { ascending: false })
    .limit(limite)
  if (error) throw error
  return ((data ?? []) as unknown as LinhaRaw[]).map((r) => ({
    origemId: r.origem_id as number,
    numeroSerie: r.numero_serie as string,
    modelo: r.modelo as string | null,
    dataInicio: r.data_inicio as string | null,
    dataFim: r.data_fim as string | null,
    status: r.status as string | null,
    observacao: r.observacao as string | null,
    seriais: Object.fromEntries(PECAS_REP.map((p) => [p.chave, (r[p.chave] as string | null) ?? null])) as IntegracaoRep['seriais'],
  }))
}
