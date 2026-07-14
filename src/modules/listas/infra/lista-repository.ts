import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface ListaRow {
  id: string
  chave: string
  nome: string
  descricao: string
  sistema: boolean
}

export interface ListaComContagem extends ListaRow {
  totalItens: number
}

export interface ItemRow {
  id: string
  lista_id: string
  valor: string
  ordem: number
  ativo: boolean
}

export interface DadosItem {
  valor: string
  ordem: number
  ativo: boolean
}

export async function listarListas(): Promise<ListaComContagem[]> {
  const supabase = await createServerSupabase()
  const { data: listas, error } = await supabase.from('listas').select('*').order('nome')
  if (error) throw error

  const { data: itens, error: erroItens } = await supabase.from('lista_itens').select('lista_id')
  if (erroItens) throw erroItens

  const contagem = new Map<string, number>()
  for (const item of (itens ?? []) as { lista_id: string }[]) {
    contagem.set(item.lista_id, (contagem.get(item.lista_id) ?? 0) + 1)
  }

  return (listas as ListaRow[]).map((lista) => ({
    ...lista,
    totalItens: contagem.get(lista.id) ?? 0,
  }))
}

export async function buscarLista(chave: string): Promise<ListaRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('listas')
    .select('*')
    .eq('chave', chave)
    .maybeSingle()
  if (error) throw error
  return (data as ListaRow | null) ?? null
}

export async function buscarListaPorId(id: string): Promise<ListaRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('listas').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as ListaRow | null) ?? null
}

export async function criarLista(dados: { chave: string; nome: string }): Promise<{ id: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('listas')
    .insert({ ...dados, sistema: false })
    .select('id')
    .single()
  if (error) throw error
  return { id: (data as { id: string }).id }
}

// Erro sentinela: a policy RLS de delete (listas_delete) usa uma cláusula
// USING que exclui linhas com sistema=true do conjunto afetado — o Postgres
// não retorna erro nesse caso, apenas 0 linhas afetadas. Detectamos isso e
// sinalizamos para a camada de aplicação traduzir numa mensagem amigável.
export const ERRO_LISTA_BLOQUEADA_EXCLUSAO = 'LISTA_BLOQUEADA_EXCLUSAO'

export async function excluirLista(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('listas').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(ERRO_LISTA_BLOQUEADA_EXCLUSAO)
  }
}

/**
 * Rótulos dos campos (`configuracao_campos`) que usam esta lista, pela `chave`.
 * Vazio = a lista não está em uso e pode ser excluída. Usado para bloquear a
 * exclusão de uma lista amarrada a um campo (que esvaziaria o dropdown / — no
 * caso da lista `resultado` — quebraria os status).
 */
export async function camposQueUsamLista(chave: string): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('configuracao_campos')
    .select('rotulo')
    .eq('lista_chave', chave)
    .order('rotulo', { ascending: true })
  if (error) throw error
  return ((data ?? []) as { rotulo: string }[]).map((r) => r.rotulo)
}

export async function listarItens(listaId: string): Promise<ItemRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('lista_itens')
    .select('*')
    .eq('lista_id', listaId)
    .order('ordem', { ascending: true })
    .order('valor', { ascending: true })
  if (error) throw error
  return data as ItemRow[]
}

export async function buscarItem(id: string): Promise<ItemRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('lista_itens')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as ItemRow | null) ?? null
}

export async function criarItem(dados: {
  listaId: string
  valor: string
  ordem: number
}): Promise<{ id: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('lista_itens')
    .insert({ lista_id: dados.listaId, valor: dados.valor, ordem: dados.ordem })
    .select('id')
    .single()
  if (error) throw error
  return { id: (data as { id: string }).id }
}

export async function atualizarItem(id: string, dados: DadosItem): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('lista_itens').update(dados).eq('id', id)
  if (error) throw error
}

export async function excluirItem(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('lista_itens').delete().eq('id', id)
  if (error) throw error
}
