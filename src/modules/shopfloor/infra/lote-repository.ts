import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { mapaPostoPerfil } from './postos-repository'
import { postoPendenteDePeca, type BipePeca } from '../domain/fluxo-op'

/** Cria (ou reaproveita) o lote dos SNs enviados juntos. `sns` e `snsNorm` alinhados 1:1. */
export async function criarLote(pmo: string, op: string, sns: string[], snsNorm: string[]): Promise<void> {
  if (snsNorm.length === 0) return
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('sf_criar_lote', {
    p_pmo: pmo, p_op: op, p_sns: sns, p_sns_norm: snsNorm,
  })
  if (error) throw error
}

/** Resultado do puxar-painel: pendentes NESTE posto + TODOS os membros do lote (norm) + o lote_id.
 *  `membrosNorm`/`loteId` servem pra tela ANCORAR o lote a um painel e barrar SN de outro painel. */
export interface LotePendente {
  pendentes: string[]
  membrosNorm: string[]
  loteId: string | null
}

/**
 * SNs do MESMO lote de `snNorm` que estão AGUARDANDO neste `posto` + os membros do painel.
 * Reusa a derivação de fila da tela de Fluxo (postoPendenteDePeca), escopada aos SNs do lote.
 */
export async function snsPendentesDoLote(
  pmo: string, op: string, posto: string, snNorm: string,
): Promise<LotePendente> {
  const supabase = await createServerSupabase()

  // 1) lote_id do SN-âncora
  const { data: ancora, error: ea } = await supabase
    .from('sf_lotes')
    .select('lote_id')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', snNorm)
    .maybeSingle()
  if (ea) throw ea
  if (!ancora?.lote_id) return { pendentes: [], membrosNorm: [], loteId: null } // SN sem lote → nada a puxar (fallback v1)

  // 2) todos os SNs do lote
  const { data: irmaos, error: ei } = await supabase
    .from('sf_lotes')
    .select('numero_serie,numero_serie_norm')
    .eq('pmo', pmo).eq('op', op).eq('lote_id', ancora.lote_id)
  if (ei) throw ei
  const membros = (irmaos ?? []) as { numero_serie: string; numero_serie_norm: string }[]
  const normSet = membros.map((m) => m.numero_serie_norm)
  if (membros.length === 0) return { pendentes: [], membrosNorm: [], loteId: ancora.lote_id }

  // 3) ordem dos postos da OP + flags do perfil (mesma base do Fluxo)
  const { data: ordemRow, error: eo } = await supabase
    .from('sf_ordens')
    .select('sf_ordem_postos(posto,ordem)')
    .eq('pmo', pmo).eq('op', op)
    .maybeSingle()
  if (eo) throw eo
  const postos = [...((ordemRow?.sf_ordem_postos ?? []) as { posto: string; ordem: number }[])]
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => p.posto)
  const perfis = await mapaPostoPerfil()
  const exige = (p: string) => perfis[p]?.exigeManutencao ?? false
  const recursoDe = (p: string) => perfis[p]?.recurso ?? 'nenhum'

  // 4) registros SÓ dos SNs do lote (query escopada → pequena)
  const { data: regs, error: er } = await supabase
    .from('sf_registros')
    .select('numero_serie,numero_serie_norm,status,posto,posto_retorno,data_hora,id')
    .eq('pmo', pmo).eq('op', op)
    .in('numero_serie_norm', normSet)
    .order('data_hora', { ascending: true })
    .order('id', { ascending: true })
  if (er) throw er
  const linhas = (regs ?? []) as { numero_serie: string; numero_serie_norm: string; status: string; posto: string; posto_retorno: string | null }[]

  // 5) agrupa por peça e roda a derivação; filtra pendentes NESTE posto
  const porPeca = new Map<string, { sn: string; regs: BipePeca[] }>()
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    const reg: BipePeca = { posto: l.posto, status: l.status, postoRetorno: l.posto_retorno ?? undefined }
    const e = porPeca.get(chave)
    if (e) e.regs.push(reg)
    else porPeca.set(chave, { sn: l.numero_serie, regs: [reg] })
  }
  const alvo = posto.toLowerCase()
  const displayPorNorm = new Map(membros.map((m) => [m.numero_serie_norm, m.numero_serie]))
  const pendentes: string[] = []
  for (const norm of normSet) {
    const peca = porPeca.get(norm)
    const regs = peca?.regs ?? [] // sem registro ainda → derivação devolve o 1º posto
    const pend = postoPendenteDePeca(regs, postos, exige, recursoDe)
    if (pend && pend.toLowerCase() === alvo) {
      pendentes.push(peca?.sn ?? displayPorNorm.get(norm) ?? norm)
    }
  }
  return { pendentes: pendentes.sort((a, b) => a.localeCompare(b)), membrosNorm: normSet, loteId: ancora.lote_id }
}
