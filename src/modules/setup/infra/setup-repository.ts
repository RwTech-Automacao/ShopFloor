import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { Face } from '../domain/face'
import type { EstadoSetup, Processo } from '../domain/tipos'

export interface OrdemSetup { pmo: string; op: string; cliente: string; descricao: string; status: string; snIni: string; snFim: string }
export interface Equipamento { id: string; processo: Processo; linha: string; equipamento: string; posicoes: number | null; ativo: boolean }
export interface ItemEstruturaCadastro { componente: string; processo: Processo; origem: 'importacao' | 'manual'; criadoEm: string }
export interface SetupResumo {
  id: string; pmo: string; op: string; processo: Processo; linha: string; equipamento: string; face: Face
  snAbertura: string; estado: EstadoSetup; criadoEm: string; liberadoEm: string | null; totalItens: number; semRolo: number
}
export interface ItemSetup { id: string; posicao: string; feeder: string; componente: string; rolo: string | null; atualizadoEm: string }
export interface Troca {
  id: string; setupId: string; pmo: string; op: string; linha: string; equipamento: string; face: Face
  posicao: string; feeder: string; roloSaida: string; roloEntrada: string; snInicial: string
  resultado: 'APROVADO' | 'REPROVADO'; motivos: string[]; operadorNome: string; dataHora: string
}
export interface Alteracao { id: string; tipo: string; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; usuarioNome: string; dataHora: string }
export interface ChaveSetup { pmo: string; op: string; processo: Processo; linha: string; equipamento: string; face: Face }
export interface FiltroSetups { cliente?: string; pmo?: string; op?: string; processo?: string; linha?: string; equipamento?: string; face?: string; estado?: string }
export interface FiltroTrocas { setupId?: string; de?: string; ate?: string; pmo?: string; op?: string; linha?: string; equipamento?: string; resultado?: string; posicao?: string; rolo?: string; sn?: string }

type Row = Record<string, unknown>
const SETUP_COLS = 'id,pmo,op,processo,linha,equipamento,face,sn_abertura,estado,criado_em,liberado_em,st_setup_itens(rolo)'

function mapSetup(r: Row): SetupResumo {
  const itens = (r.st_setup_itens ?? []) as { rolo: string | null }[]
  return {
    id: r.id as string, pmo: r.pmo as string, op: r.op as string, processo: r.processo as Processo,
    linha: r.linha as string, equipamento: r.equipamento as string, face: r.face as Face,
    snAbertura: r.sn_abertura as string, estado: r.estado as EstadoSetup, criadoEm: r.criado_em as string,
    liberadoEm: (r.liberado_em as string | null) ?? null, totalItens: itens.length, semRolo: itens.filter((i) => i.rolo === null).length,
  }
}
const mapItem = (r: Row): ItemSetup => ({
  id: r.id as string, posicao: r.posicao as string, feeder: r.feeder as string, componente: r.componente as string,
  rolo: (r.rolo as string | null) ?? null, atualizadoEm: r.atualizado_em as string,
})
const mapTroca = (r: Row): Troca => {
  const s = (r.st_setups ?? {}) as Row
  return {
    id: r.id as string, setupId: r.setup_id as string, pmo: s.pmo as string, op: s.op as string, linha: s.linha as string,
    equipamento: s.equipamento as string, face: s.face as Face, posicao: r.posicao as string, feeder: r.feeder as string,
    roloSaida: r.rolo_saida as string, roloEntrada: r.rolo_entrada as string, snInicial: r.sn_inicial as string,
    resultado: r.resultado as Troca['resultado'], motivos: (r.motivos as string[]) ?? [], operadorNome: r.operador_nome as string,
    dataHora: r.data_hora as string,
  }
}

export async function chamarRpc<T>(nome: string, params: Record<string, unknown>): Promise<T> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc(nome, params)
  if (error) throw new Error(error.message)
  return data as unknown as T
}

export async function listarOrdensSetup(): Promise<OrdemSetup[]> {
  const rows = await chamarRpc<Row[]>('st_listar_ordens', {})
  return (rows ?? []).map((r) => ({
    pmo: r.pmo as string, op: r.op as string, cliente: (r.cliente as string) ?? '', descricao: (r.descricao as string) ?? '',
    status: (r.status as string) ?? '', snIni: (r.sn_ini as string) ?? '', snFim: (r.sn_fim as string) ?? '',
  }))
}

export async function listarEquipamentos(apenasAtivos = false): Promise<Equipamento[]> {
  const supabase = await createServerSupabase()
  let q = supabase.from('st_equipamentos').select('id,processo,linha,equipamento,posicoes,ativo').order('processo').order('linha').order('equipamento')
  if (apenasAtivos) q = q.eq('ativo', true)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id as string, processo: r.processo as Processo, linha: r.linha as string, equipamento: r.equipamento as string,
    posicoes: (r.posicoes as number | null) ?? null, ativo: r.ativo as boolean,
  }))
}

export async function listarEstrutura(pmo: string): Promise<ItemEstruturaCadastro[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_estrutura').select('componente,processo,origem,criado_em').eq('pmo', pmo.trim()).order('processo').order('componente')
  if (error) throw error
  return ((data ?? []) as Row[]).map((r) => ({ componente: r.componente as string, processo: r.processo as Processo, origem: r.origem as ItemEstruturaCadastro['origem'], criadoEm: r.criado_em as string }))
}

export async function listarPmosComEstrutura(): Promise<{ pmo: string; total: number }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_estrutura').select('pmo')
  if (error) throw error
  const cont = new Map<string, number>()
  for (const r of (data ?? []) as Row[]) cont.set(r.pmo as string, (cont.get(r.pmo as string) ?? 0) + 1)
  return [...cont.entries()].map(([pmo, total]) => ({ pmo, total })).sort((a, b) => a.pmo.localeCompare(b.pmo))
}

export async function buscarSetupPorChave(k: ChaveSetup): Promise<SetupResumo | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_setups').select(SETUP_COLS)
    .eq('pmo', k.pmo).eq('op', k.op).eq('processo', k.processo).eq('linha', k.linha).eq('equipamento', k.equipamento).eq('face', k.face)
    .maybeSingle()
  if (error) throw error
  return data ? mapSetup(data as Row) : null
}

export async function carregarSetup(id: string): Promise<{ setup: SetupResumo; itens: ItemSetup[] } | null> {
  const supabase = await createServerSupabase()
  const [{ data: s, error: e1 }, { data: itens, error: e2 }] = await Promise.all([
    supabase.from('st_setups').select(SETUP_COLS).eq('id', id).maybeSingle(),
    supabase.from('st_setup_itens').select('id,posicao,feeder,componente,rolo,atualizado_em').eq('setup_id', id),
  ])
  if (e1) throw e1
  if (e2) throw e2
  if (!s) return null
  const lista = ((itens ?? []) as Row[]).map(mapItem)
  // Ordena posição numérica quando dá ("2" antes de "10"), senão texto.
  lista.sort((a, b) => a.posicao.localeCompare(b.posicao, 'pt-BR', { numeric: true }) || a.feeder.localeCompare(b.feeder, 'pt-BR', { numeric: true }))
  return { setup: mapSetup(s as Row), itens: lista }
}

export async function listarSetupsParaCopiar(k: Omit<ChaveSetup, 'op'> & { excetoOp: string }): Promise<SetupResumo[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_setups').select(SETUP_COLS)
    .eq('pmo', k.pmo).eq('processo', k.processo).eq('linha', k.linha).eq('equipamento', k.equipamento).eq('face', k.face)
    .neq('op', k.excetoOp).order('criado_em', { ascending: false }).limit(20)
  if (error) throw error
  return ((data ?? []) as Row[]).map(mapSetup)
}

export async function listarSetups(f: FiltroSetups): Promise<SetupResumo[]> {
  const supabase = await createServerSupabase()
  let q = supabase.from('st_setups').select(SETUP_COLS).order('criado_em', { ascending: false }).limit(500)
  if (f.pmo) q = q.ilike('pmo', `%${f.pmo.trim()}%`)
  if (f.op) q = q.ilike('op', `%${f.op.trim()}%`)
  if (f.processo) q = q.eq('processo', f.processo)
  if (f.linha) q = q.eq('linha', f.linha)
  if (f.equipamento) q = q.eq('equipamento', f.equipamento)
  if (f.face) q = q.eq('face', f.face)
  if (f.estado) q = q.eq('estado', f.estado)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as Row[]).map(mapSetup)
}

export async function listarTrocas(f: FiltroTrocas, pagina: number, tamanho: number): Promise<{ linhas: Troca[]; total: number }> {
  const supabase = await createServerSupabase()
  let q = supabase.from('st_trocas')
    .select('id,setup_id,posicao,feeder,rolo_saida,rolo_entrada,sn_inicial,resultado,motivos,operador_nome,data_hora,st_setups!inner(pmo,op,linha,equipamento,face)', { count: 'exact' })
    .order('data_hora', { ascending: false })
  if (f.setupId) q = q.eq('setup_id', f.setupId)
  if (f.de) q = q.gte('data_hora', `${f.de}T00:00:00-03:00`)
  if (f.ate) q = q.lte('data_hora', `${f.ate}T23:59:59-03:00`)
  if (f.pmo) q = q.ilike('st_setups.pmo', `%${f.pmo.trim()}%`)
  if (f.op) q = q.ilike('st_setups.op', `%${f.op.trim()}%`)
  if (f.linha) q = q.eq('st_setups.linha', f.linha)
  if (f.equipamento) q = q.eq('st_setups.equipamento', f.equipamento)
  if (f.resultado) q = q.eq('resultado', f.resultado)
  if (f.posicao) q = q.eq('posicao', f.posicao.trim().toUpperCase())
  if (f.rolo) {
    const r = f.rolo.trim().toUpperCase().replace(/[%_\\]/g, (c) => `\\${c}`)
    q = q.or(`rolo_saida.ilike.%${r}%,rolo_entrada.ilike.%${r}%`)
  }
  if (f.sn) q = q.ilike('sn_inicial', `%${f.sn.replace(/[^A-Za-z0-9]/g, '')}%`)
  const { data, error, count } = await q.range(pagina * tamanho, pagina * tamanho + tamanho - 1)
  if (error) throw error
  return { linhas: ((data ?? []) as Row[]).map(mapTroca), total: count ?? 0 }
}

export async function listarAlteracoes(setupId: string): Promise<Alteracao[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('st_alteracoes').select('id,tipo,antes,depois,usuario_nome,data_hora').eq('setup_id', setupId).order('data_hora', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id as string, tipo: r.tipo as string, antes: (r.antes as Record<string, unknown> | null) ?? null,
    depois: (r.depois as Record<string, unknown> | null) ?? null, usuarioNome: r.usuario_nome as string, dataHora: r.data_hora as string,
  }))
}

export async function inserirEquipamento(e: { processo: Processo; linha: string; equipamento: string; posicoes: number | null }): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('st_equipamentos').insert(e)
  if (error) return { ok: false, erro: error.code === '23505' ? 'Esse equipamento já está cadastrado.' : 'Não foi possível cadastrar.' }
  return { ok: true }
}

export async function alternarEquipamento(id: string, ativo: boolean): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('st_equipamentos').update({ ativo }).eq('id', id)
  if (error) throw error
}

export async function inserirComponente(pmo: string, componente: string, processo: Processo, criadoPor: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('st_estrutura').insert({ pmo, componente, processo, origem: 'manual', criado_por: criadoPor })
  if (error) return { ok: false, erro: error.code === '23505' ? 'Esse componente já está na estrutura.' : 'Não foi possível adicionar.' }
  return { ok: true }
}

export async function removerComponente(pmo: string, componente: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('st_estrutura').delete().eq('pmo', pmo).eq('componente', componente)
  if (error) throw error
}
