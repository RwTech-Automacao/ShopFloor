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
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('sf_estruturas')
    .select('pmo, situacao, origem, sf_estrutura_trechos(seq, codigo, descricao, posto_conclui, sn_modo, estoque)')
    .eq('pmo', pmo)
    .maybeSingle()
  if (error) throw new Error(`sf_estruturas: ${error.message}`)
  if (!data) return null
  const e = data as unknown as Omit<EstruturaView, 'trechos'> & { sf_estrutura_trechos: LinhaTrecho[] }
  return {
    pmo: e.pmo, situacao: e.situacao, origem: e.origem,
    trechos: [...e.sf_estrutura_trechos].sort((x, y) => x.seq - y.seq).map(paraTrecho),
  }
}

/** Grava a receita inteira (substitui os trechos) e volta para rascunho, numa transação só (RPC sf_salvar_estrutura). */
export async function salvarEstrutura(pmo: string, trechos: TrechoReceita[], usuario: string, origem?: string): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.rpc('sf_salvar_estrutura', {
    p_pmo: pmo,
    p_trechos: trechos.map((t) => ({ seq: t.seq, codigo: t.codigo.trim(), descricao: t.descricao, posto_conclui: t.postoConclui, sn_modo: t.snModo, estoque: t.estoque })),
    p_usuario: usuario,
    p_origem: origem ?? null,
  })
  if (error) throw new Error(`sf_salvar_estrutura: ${error.message}`)
}

export async function marcarAtiva(pmo: string, usuario: string): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.from('sf_estruturas').update({ situacao: 'ativa', alterado_em: new Date().toISOString(), alterado_por: usuario }).eq('pmo', pmo)
  if (error) throw new Error(`sf_estruturas (ativar): ${error.message}`)
}

/** Rota da OP mais recente da PMO (a referência para validar os postos da receita). */
export async function rotaDeReferencia(pmo: string): Promise<string[]> {
  const sb = await createServerSupabase()
  const busca = async (filtro: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data, error } = await filtro(
      sb.from('sf_ordens').select('created_at, sf_ordem_postos(posto, ordem)').order('created_at', { ascending: false }).limit(1),
    )
    if (error) throw new Error(`rota da PMO: ${error.message}`)
    return (data?.[0] as { sf_ordem_postos?: { posto: string; ordem: number }[] } | undefined)?.sf_ordem_postos ?? null
  }
  // Sem OP com exatamente essa PMO, cai nas variantes com sufixo (PMOX_F).
  const postos = (await busca((q) => q.eq('pmo', pmo))) ?? (await busca((q) => q.like('pmo', `${pmo.replace(/[\\%_]/g, '\\$&')}\\_%`))) ?? []
  return [...postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto)
}

/** A OP mais recente (com número só de dígitos, opcionalmente com sufixo _/_F) de cada PMO do ShopFloor. */
export async function ultimaOpNumericaPorPmo(): Promise<{ pmo: string; op: string }[]> {
  const sb = await createServerSupabase()
  const vistas = new Map<string, string>()
  const PAGINA = 1000
  for (let ini = 0; ; ini += PAGINA) {
    const { data, error } = await sb.from('sf_ordens').select('pmo, op, created_at')
      .order('created_at', { ascending: false }).order('id').range(ini, ini + PAGINA - 1)
    if (error) throw new Error(`sf_ordens: ${error.message}`)
    const linhas = (data ?? []) as { pmo: string; op: string }[]
    for (const o of linhas) {
      const pmo = o.pmo.replace(/_[A-Za-z]*$/, '')
      if (!vistas.has(pmo) && /^\d+(_[A-Za-z]*)?$/.test(o.op)) vistas.set(pmo, o.op)
    }
    if (linhas.length < PAGINA) break
  }
  return [...vistas].map(([pmo, op]) => ({ pmo, op }))
}

/** Os trechos que a OP já carrega (a cópia da receita feita na criação). */
export async function trechosDaOp(ordemId: string): Promise<{ seq: number; codigo: string; compelsOp: string | null }[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sf_ordem_trechos').select('seq, codigo, compels_op').eq('ordem_id', ordemId).order('seq')
  if (error) throw new Error(`sf_ordem_trechos: ${error.message}`)
  return ((data ?? []) as { seq: number; codigo: string; compels_op: string | null }[]).map((t) => ({ seq: t.seq, codigo: t.codigo, compelsOp: t.compels_op }))
}

/**
 * Copia a receita ATIVA da PMO para a OP (só trechos cujo posto está na rota da OP). Só mexe na cópia
 * existente depois de confirmar que há receita ativa com trechos válidos para gravar.
 * Devolve os trechos copiados (vazio = PMO sem estrutura ativa; nada é apagado).
 */
export async function copiarParaOp(ordemId: string, pmo: string, rotaDaOp: string[]): Promise<{ seq: number; codigo: string }[]> {
  const e = await estruturaDaPmo(pmo.replace(/_[A-Za-z]*$/, ''))
  if (!e || e.situacao !== 'ativa') return []
  const validos = e.trechos.filter((t) => t.postoConclui && rotaDaOp.includes(t.postoConclui))
  if (validos.length === 0) return []
  const sb = await createServerSupabase()
  const { error: e1 } = await sb.from('sf_ordem_trechos').delete().eq('ordem_id', ordemId)
  if (e1) throw new Error(`sf_ordem_trechos (limpar): ${e1.message}`)
  const { error: e2 } = await sb.from('sf_ordem_trechos').insert(
    validos.map((t) => ({ ordem_id: ordemId, seq: t.seq, codigo: t.codigo, posto_conclui: t.postoConclui, sn_modo: t.snModo, estoque: t.estoque })),
  )
  if (e2) throw new Error(`sf_ordem_trechos: ${e2.message}`)
  return validos.map((t) => ({ seq: t.seq, codigo: t.codigo }))
}

/** Zera a OP filha de todos os trechos da OP (a OP mudou de número: as filhas antigas não valem mais). */
export async function limparFilhas(ordemId: string): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.from('sf_ordem_trechos').update({ compels_op: null }).eq('ordem_id', ordemId)
  if (error) throw new Error(`sf_ordem_trechos (limpar filhas): ${error.message}`)
  // As entradas pendentes e livres da fila voltam a op = '' (sf_estoque_envios só aceita escrita do servidor).
  const { error: e2 } = await createServiceSupabase().from('sf_estoque_envios').update({ op: '' })
    .eq('ordem_id', ordemId).eq('operacao', 'entrada').eq('ok', false).is('cancelado_em', null).is('reservado_em', null).neq('op', '')
  if (e2) throw new Error(`sf_estoque_envios (limpar filhas): ${e2.message}`)
}

/**
 * Grava a OP filha casada de cada trecho e acerta as linhas PENDENTES da fila desse trecho: com filha, passam a
 * apontar para ela; sem filha, voltam a op = ''. Linhas já enviadas (ok) nunca são tocadas.
 */
export async function gravarFilhas(ordemId: string, filhas: Map<number, number | null>): Promise<void> {
  const sb = await createServerSupabase()
  for (const [seq, numero] of filhas) {
    const { data, error } = await sb.from('sf_ordem_trechos')
      .update({ compels_op: numero === null ? null : String(numero) })
      .eq('ordem_id', ordemId).eq('seq', seq).select('codigo')
    if (error) throw new Error(`sf_ordem_trechos (filha): ${error.message}`)
    const codigo = (data?.[0] as { codigo?: string } | undefined)?.codigo
    if (!codigo) continue
    // sf_estoque_envios só tem policy de select (0132): quem grava é o servidor. Quem chama (a action) já exigiu shopfloor.administrar.
    // A chave não é recalculada de propósito: guarda a op antiga só como texto de identidade e segue única.
    // Só entradas pendentes e não reservadas: estorno herda a op da entrada que reverte; reservada o cron está enviando.
    const novo = numero === null ? '' : String(numero)
    const { error: e2 } = await createServiceSupabase().from('sf_estoque_envios').update({ op: novo })
      .eq('ordem_id', ordemId).eq('pmo', codigo).eq('operacao', 'entrada').eq('ok', false)
      .is('cancelado_em', null).is('reservado_em', null).neq('op', novo)
    if (e2) throw new Error(`sf_estoque_envios (filha): ${e2.message}`)
  }
}

export interface ResumoTrecho { posto: string; codigo: string; compelsOp: string | null; apontadas: number; naFila: number; motivo: string | null }

/** Por trecho da OP: quantas peças já foram apontadas no Compels (entradas − estornos enviados) e quantas esperam. */
export async function resumoTrechosDaOp(pmo: string, op: string): Promise<ResumoTrecho[]> {
  const sb = await createServerSupabase()
  const { data: o, error: e1 } = await sb.from('sf_ordens')
    .select('id, sf_ordem_trechos(seq, codigo, posto_conclui, compels_op)').eq('pmo', pmo).eq('op', op).maybeSingle()
  if (e1) throw new Error(`sf_ordens: ${e1.message}`)
  const ordem = o as { id: string; sf_ordem_trechos: { seq: number; codigo: string; posto_conclui: string; compels_op: string | null }[] } | null
  if (!ordem || ordem.sf_ordem_trechos.length === 0) return []
  const { data: linhas, error: e2 } = await sb.from('sf_estoque_envios')
    .select('pmo, operacao, quantidade, ok, cancelado_em, erro, criado_em').eq('ordem_id', ordem.id)
  if (e2) throw new Error(`sf_estoque_envios: ${e2.message}`)
  const ls = (linhas ?? []) as { pmo: string; operacao: string; quantidade: number; ok: boolean; cancelado_em: string | null; erro: string | null; criado_em: string }[]
  return [...ordem.sf_ordem_trechos].sort((a, b) => a.seq - b.seq).map((t) => {
    const dele = ls.filter((l) => l.pmo === t.codigo && !l.cancelado_em)
    const sinal = (l: { operacao: string }) => (l.operacao === 'estorno' ? -1 : 1)
    const pend = dele.filter((l) => !l.ok && l.operacao === 'entrada').sort((a, b) => a.criado_em.localeCompare(b.criado_em))
    return {
      posto: t.posto_conclui,
      codigo: t.codigo,
      compelsOp: t.compels_op,
      apontadas: dele.filter((l) => l.ok).reduce((s, l) => s + sinal(l) * l.quantidade, 0),
      naFila: pend.reduce((s, l) => s + l.quantidade, 0),
      motivo: pend[0]?.erro ?? null,
    }
  })
}
