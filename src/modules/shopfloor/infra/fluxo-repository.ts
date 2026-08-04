import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { mapaPostoPerfil } from './postos-repository'
import type { FluxoAgregado } from '../domain/fluxo-op'

export interface OpItem { pmo: string; op: string; cliente: string; descricao: string }
export interface SnDoPosto { sn: string; status: string; vezes: number }

/** Todas as OPs (pra escolher no seletor do Fluxo). */
export async function listarOrdens(): Promise<OpItem[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo,op,cliente,descricao')
    .order('pmo')
    .order('op')
  if (error) throw error
  return (data ?? []) as OpItem[]
}

/** Postos ordenados do fluxo + agregados (RPC) + mapa temStatus/recurso por posto + qtd da OP. */
export async function carregarFluxoOp(
  pmo: string,
  op: string,
): Promise<{
  postos: string[]
  agregados: FluxoAgregado[]
  temStatus: Record<string, boolean>
  recurso: Record<string, string>
  qtd: number | null
}> {
  const supabase = await createServerSupabase()

  const { data: ordem, error: e1 } = await supabase
    .from('sf_ordens')
    .select('qtd,sf_ordem_postos(posto,ordem)')
    .eq('pmo', pmo)
    .eq('op', op)
    .maybeSingle()
  if (e1) throw e1
  const lista = ((ordem?.sf_ordem_postos ?? []) as { posto: string; ordem: number }[])
  const postos = [...lista].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto)
  const qtd = (ordem?.qtd ?? null) as number | null

  const { data: agg, error: e2 } = await supabase.rpc('sf_fluxo_op', { p_pmo: pmo, p_op: op })
  if (e2) throw e2
  const agregados = (agg ?? []) as FluxoAgregado[]

  const perfis = await mapaPostoPerfil()
  const temStatus: Record<string, boolean> = {}
  const recurso: Record<string, string> = {}
  for (const p of postos) {
    temStatus[p] = perfis[p]?.temStatus ?? false
    recurso[p] = perfis[p]?.recurso ?? 'nenhum'
  }

  return { postos, agregados, temStatus, recurso, qtd }
}

/** SNs registrados num posto da OP (lazy, ao abrir o nó). Paginado. */
export async function carregarSnsDoPosto(pmo: string, op: string, posto: string): Promise<SnDoPosto[]> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; data_hora: string }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,status,data_hora,id')
      .eq('pmo', pmo)
      .eq('op', op)
      .ilike('posto', posto)
      .order('data_hora', { ascending: false })
      .order('id', { ascending: false }) // desempate estável: sem isso, data_hora empatado embaralha as páginas (repete/pula SN)
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  // Agrupa por SN (normalizado): status = o mais recente (linhas já vêm desc por data_hora), vezes = nº de registros.
  const porSn = new Map<string, SnDoPosto>()
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    const atual = porSn.get(chave)
    if (atual) atual.vezes += 1
    else porSn.set(chave, { sn: l.numero_serie, status: l.status, vezes: 1 })
  }
  return [...porSn.values()].sort((a, b) => a.sn.localeCompare(b.sn))
}

/**
 * SNs que estão em Manutenção AGORA = peças cujo ÚLTIMO bipe (em qualquer posto) foi reprovado
 * — mesma regra do WIP de Manutenção na RPC. O `status` traz o posto onde reprovou (onde a peça travou).
 * (Difere de carregarSnsDoPosto('Manutenção'), que traria só registros de reparo.)
 */
export async function carregarSnsEmManutencao(pmo: string, op: string): Promise<SnDoPosto[]> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; posto: string; data_hora: string }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,status,posto,data_hora,id')
      .eq('pmo', pmo)
      .eq('op', op)
      .neq('numero_serie_norm', '')
      .order('data_hora', { ascending: false })
      .order('id', { ascending: false })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  // linhas desc por (data_hora,id): a PRIMEIRA de cada SN é o último bipe. Em manutenção = último = reprovado.
  const visto = new Set<string>()
  const res: SnDoPosto[] = []
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    if (visto.has(chave)) continue
    visto.add(chave)
    if (l.status.toLowerCase() === 'reprovado') {
      res.push({ sn: l.numero_serie, status: `Reprovado · ${l.posto}`, vezes: 1 })
    }
  }
  return res.sort((a, b) => a.sn.localeCompare(b.sn))
}
