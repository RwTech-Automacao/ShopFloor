import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { mapaPostoPerfil } from './postos-repository'
import { numerarPassagens, type FluxoAgregado, type PassagemPosto, type RegistroPassagem } from '../domain/fluxo-op'
import { pareaBurnin, estaAberto, type RegistroBurnin } from '../domain/burnin'

export interface OpItem { pmo: string; op: string; cliente: string; descricao: string }
export interface SnDoPosto { sn: string; status: string; vezes: number }
export interface DetalhePosto { agora: SnDoPosto[]; historico: PassagemPosto[] }
/** Peça com Burn-in em andamento: SN + hora de entrada (ISO) do ciclo aberto. */
export interface BurninEmAndamento { sn: string; desde: string }

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
  exigeManutencao: Record<string, boolean>
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
  const exigeManutencao: Record<string, boolean> = {}
  for (const p of postos) {
    temStatus[p] = perfis[p]?.temStatus ?? false
    recurso[p] = perfis[p]?.recurso ?? 'nenhum'
    exigeManutencao[p] = perfis[p]?.exigeManutencao ?? false
  }

  return { postos, agregados, temStatus, recurso, exigeManutencao, qtd }
}

/**
 * Detalhe de um posto (lazy, ao abrir o nó). Um único scan da OP devolve:
 *  - `agora`: peças que estão NO posto neste momento (posição atual = último bipe no posto, não reprovado
 *     — reprovado está em Manutenção), coerente com o WIP/badge;
 *  - `historico`: todas as peças que já passaram pelo posto (último status ali + nº de bipes).
 */
export async function carregarDetalhePosto(pmo: string, op: string, posto: string): Promise<DetalhePosto> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; posto: string; data_hora: string; id: number }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,status,posto,data_hora,id')
      .eq('pmo', pmo)
      .eq('op', op)
      .neq('numero_serie_norm', '')
      .order('data_hora', { ascending: false })
      .order('id', { ascending: false }) // desempate estável (data_hora empatado embaralharia as páginas)
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  const alvo = posto.toLowerCase()
  const passagens: RegistroPassagem[] = [] // cada bipe da peça NO posto (pra numerar 1x/2x…)
  const atual = new Map<string, { posto: string; status: string; sn: string }>() // posição atual (1º visto = mais recente)
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    if (!atual.has(chave)) atual.set(chave, { posto: l.posto, status: l.status, sn: l.numero_serie })
    if (l.posto.toLowerCase() === alvo) {
      passagens.push({ chave, sn: l.numero_serie, status: l.status, dataHora: l.data_hora, ordem: l.id })
    }
  }
  const agora: SnDoPosto[] = []
  for (const v of atual.values()) {
    if (v.posto.toLowerCase() === alvo && v.status.toLowerCase() !== 'reprovado') {
      agora.push({ sn: v.sn, status: v.status, vezes: 1 })
    }
  }
  return {
    agora: agora.sort((a, b) => a.sn.localeCompare(b.sn)),
    historico: numerarPassagens(passagens),
  }
}

/**
 * SNs que estão em Manutenção AGORA = peças cujo ÚLTIMO bipe (em qualquer posto) foi reprovado
 * — mesma regra do WIP de Manutenção na RPC. O `status` traz o posto onde reprovou (onde a peça travou).
 * (Difere de carregarSnsDoPosto('Manutenção'), que traria só registros de reparo.)
 */
export async function carregarSnsEmManutencao(pmo: string, op: string): Promise<SnDoPosto[]> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; posto: string; data_hora: string; id: number }[] = []
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

/**
 * Peças com Burn-in EM ANDAMENTO no posto = ciclo aberto (entrada sem saída = "cozinhando"),
 * com a hora de entrada do ciclo aberto. Entrada mais antiga (mais tempo) primeiro.
 */
export async function carregarBurninEmAndamento(pmo: string, op: string, posto: string): Promise<BurninEmAndamento[]> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; data_hora: string }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,status,data_hora')
      .eq('pmo', pmo)
      .eq('op', op)
      .eq('posto', posto)
      .neq('numero_serie_norm', '')
      .order('data_hora', { ascending: true })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  const porPeca = new Map<string, { sn: string; regs: RegistroBurnin[] }>()
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    const e = porPeca.get(chave)
    if (e) e.regs.push({ dataHora: l.data_hora, status: l.status })
    else porPeca.set(chave, { sn: l.numero_serie, regs: [{ dataHora: l.data_hora, status: l.status }] })
  }
  const res: BurninEmAndamento[] = []
  for (const { sn, regs } of porPeca.values()) {
    const ciclos = pareaBurnin(regs)
    const ultimo = ciclos[ciclos.length - 1]
    if (estaAberto(ciclos) && ultimo) res.push({ sn, desde: ultimo.entrada })
  }
  return res.sort((a, b) => a.desde.localeCompare(b.desde))
}
