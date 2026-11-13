import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type { EstoqueTrecho, SnModo, TrechoReceita } from '../domain/estrutura'

export interface EstruturaView {
  pmo: string
  situacao: 'rascunho' | 'ativa'
  origem: string
  trechos: TrechoReceita[]
}

interface LinhaTrecho { seq: number; codigo: string; descricao: string; posto_conclui: string | null; sn_modo: SnModo; estoque: EstoqueTrecho }
const paraTrecho = (l: LinhaTrecho): TrechoReceita => ({
  seq: l.seq, codigo: l.codigo, descricao: l.descricao, postoConclui: l.posto_conclui, snModo: l.sn_modo, estoque: l.estoque,
})

export async function listarEstruturas(): Promise<EstruturaView[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('sf_estruturas')
    .select('pmo, situacao, origem, sf_estrutura_trechos(seq, codigo, descricao, posto_conclui, sn_modo, estoque)')
    .order('pmo')
  if (error) throw new Error(`sf_estruturas: ${error.message}`)
  return ((data ?? []) as unknown as (Omit<EstruturaView, 'trechos'> & { sf_estrutura_trechos: LinhaTrecho[] })[]).map((e) => ({
    pmo: e.pmo, situacao: e.situacao, origem: e.origem,
    trechos: [...e.sf_estrutura_trechos].sort((a, b) => a.seq - b.seq).map(paraTrecho),
  }))
}

export async function estruturaDaPmo(pmo: string): Promise<EstruturaView | null> {
  return (await listarEstruturas()).find((e) => e.pmo === pmo) ?? null
}

/** Grava a receita inteira (substitui os trechos) e volta para rascunho: mudou, precisa conferir e ativar de novo. */
export async function salvarEstrutura(pmo: string, trechos: TrechoReceita[], usuario: string, origem?: string): Promise<void> {
  const sb = await createServerSupabase()
  const agora = new Date().toISOString()
  const { error: e1 } = await sb.from('sf_estruturas').upsert(
    { pmo, situacao: 'rascunho', alterado_em: agora, alterado_por: usuario, ...(origem ? { origem } : {}), criado_por: usuario },
    { onConflict: 'pmo', ignoreDuplicates: false },
  )
  if (e1) throw new Error(`sf_estruturas: ${e1.message}`)
  const { error: e2 } = await sb.from('sf_estrutura_trechos').delete().eq('pmo', pmo)
  if (e2) throw new Error(`sf_estrutura_trechos (limpar): ${e2.message}`)
  if (trechos.length === 0) return
  const { error: e3 } = await sb.from('sf_estrutura_trechos').insert(
    trechos.map((t) => ({ pmo, seq: t.seq, codigo: t.codigo.trim(), descricao: t.descricao, posto_conclui: t.postoConclui, sn_modo: t.snModo, estoque: t.estoque })),
  )
  if (e3) throw new Error(`sf_estrutura_trechos: ${e3.message}`)
}

export async function marcarAtiva(pmo: string, usuario: string): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.from('sf_estruturas').update({ situacao: 'ativa', alterado_em: new Date().toISOString(), alterado_por: usuario }).eq('pmo', pmo)
  if (error) throw new Error(`sf_estruturas (ativar): ${error.message}`)
}

/** Rota da OP mais recente da PMO (a referência para validar os postos da receita). */
export async function rotaDeReferencia(pmo: string): Promise<string[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('sf_ordens').select('created_at, sf_ordem_postos(posto, ordem)')
    .eq('pmo', pmo).order('created_at', { ascending: false }).limit(1)
  if (error) throw new Error(`rota da PMO: ${error.message}`)
  const postos = ((data?.[0] as { sf_ordem_postos?: { posto: string; ordem: number }[] } | undefined)?.sf_ordem_postos ?? [])
  return [...postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto)
}

/** A OP mais recente (com número só de dígitos, opcionalmente com sufixo _/_F) de cada PMO do ShopFloor. */
export async function ultimaOpNumericaPorPmo(): Promise<{ pmo: string; op: string }[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sf_ordens').select('pmo, op, created_at').order('created_at', { ascending: false })
  if (error) throw new Error(`sf_ordens: ${error.message}`)
  const vistas = new Map<string, string>()
  for (const o of (data ?? []) as { pmo: string; op: string }[]) {
    const pmo = o.pmo.replace(/_[A-Za-z]*$/, '')
    if (!vistas.has(pmo) && /^\d+/.test(o.op)) vistas.set(pmo, o.op)
  }
  return [...vistas].map(([pmo, op]) => ({ pmo, op }))
}

/**
 * Copia a receita ATIVA da PMO para a OP (substitui a cópia anterior; só trechos cujo posto está na rota da OP).
 * Devolve os trechos copiados (vazio = PMO sem estrutura ativa).
 */
export async function copiarParaOp(ordemId: string, pmo: string, rotaDaOp: string[]): Promise<{ seq: number; codigo: string }[]> {
  const e = await estruturaDaPmo(pmo.replace(/_[A-Za-z]*$/, ''))
  const sb = await createServerSupabase()
  const { error: e1 } = await sb.from('sf_ordem_trechos').delete().eq('ordem_id', ordemId)
  if (e1) throw new Error(`sf_ordem_trechos (limpar): ${e1.message}`)
  if (!e || e.situacao !== 'ativa') return []
  const validos = e.trechos.filter((t) => t.postoConclui && rotaDaOp.includes(t.postoConclui))
  if (validos.length === 0) return []
  const { error: e2 } = await sb.from('sf_ordem_trechos').insert(
    validos.map((t) => ({ ordem_id: ordemId, seq: t.seq, codigo: t.codigo, posto_conclui: t.postoConclui, sn_modo: t.snModo, estoque: t.estoque })),
  )
  if (e2) throw new Error(`sf_ordem_trechos: ${e2.message}`)
  return validos.map((t) => ({ seq: t.seq, codigo: t.codigo }))
}

/** Grava a OP filha casada de cada trecho e corrige as linhas da fila que nasceram sem ela (op = ''). */
export async function gravarFilhas(ordemId: string, filhas: Map<number, number | null>): Promise<void> {
  const sb = await createServerSupabase()
  for (const [seq, numero] of filhas) {
    const { data, error } = await sb.from('sf_ordem_trechos')
      .update({ compels_op: numero === null ? null : String(numero) })
      .eq('ordem_id', ordemId).eq('seq', seq).select('codigo')
    if (error) throw new Error(`sf_ordem_trechos (filha): ${error.message}`)
    const codigo = (data?.[0] as { codigo?: string } | undefined)?.codigo
    if (numero !== null && codigo) {
      // sf_estoque_envios só tem policy de select (0132): quem grava é o servidor. A action já exigiu shopfloor.administrar.
      const { error: e2 } = await createServiceSupabase().from('sf_estoque_envios').update({ op: String(numero) })
        .eq('ordem_id', ordemId).eq('pmo', codigo).eq('op', '').eq('ok', false).is('cancelado_em', null)
      if (e2) throw new Error(`sf_estoque_envios (filha): ${e2.message}`)
    }
  }
}
