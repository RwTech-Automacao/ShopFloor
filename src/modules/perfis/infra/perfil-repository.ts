import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { PerfilRow } from '@/modules/auth/domain/mapear-perfil'
import type { Modulo, Permissao } from '@/modules/auth/domain/perfil'

export interface DadosPerfil {
  nome: string
  pode_visualizar: boolean
  pode_importar: boolean
  pode_editar: boolean
  pode_finalizar: boolean
  pode_editar_finalizado: boolean
  pode_excluir: boolean
  pode_gerar_etiqueta: boolean
  pode_administrar: boolean
  pode_lancar: boolean
}

export async function listarPerfis(): Promise<PerfilRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('perfis').select('*').order('nome')
  if (error) throw error
  return data as PerfilRow[]
}

export async function buscarPerfil(id: string): Promise<PerfilRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('perfis').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as PerfilRow | null) ?? null
}

// Igual a listarPerfis, mas traz também os grants (perfil_permissao) — usado
// pela tela de edição de perfis, que renderiza um accordion por módulo.
export async function listarPerfisComGrants(): Promise<PerfilRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('perfis')
    .select('*, perfil_permissao(modulo,permissao)')
    .order('nome')
  if (error) throw error
  return data as PerfilRow[]
}

export async function criarPerfil(dados: DadosPerfil): Promise<{ id: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('perfis')
    .insert({ ...dados, sistema: false })
    .select('id')
    .single()
  if (error) throw error
  return { id: (data as { id: string }).id }
}

export async function atualizarPerfil(id: string, dados: DadosPerfil): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('perfis').update(dados).eq('id', id)
  if (error) throw error
}

// Erro sentinela: a policy RLS de delete usa uma cláusula USING que exclui
// linhas com sistema=true do conjunto afetado — o Postgres não retorna um
// erro nesse caso, apenas 0 linhas afetadas. Detectamos isso e sinalizamos
// para a camada de aplicação traduzir numa mensagem amigável.
export const ERRO_PERFIL_BLOQUEADO_EXCLUSAO = 'PERFIL_BLOQUEADO_EXCLUSAO'

export async function excluirPerfil(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('perfis').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(ERRO_PERFIL_BLOQUEADO_EXCLUSAO)
  }
}

// Ressincroniza os grants granulares (perfil_permissao) do perfil: apaga
// tudo que existia e reinsere só os marcados. Sem transação real (o supabase-js
// não expõe uma), mas é chamada logo após gravar os pode_* — ver salvarPerfil.
export async function sincronizarGrants(
  perfilId: string,
  grants: { modulo: Modulo; permissao: Permissao }[],
): Promise<void> {
  const supabase = await createServerSupabase()
  const { error: erroDelete } = await supabase
    .from('perfil_permissao')
    .delete()
    .eq('perfil_id', perfilId)
  if (erroDelete) throw erroDelete

  if (grants.length === 0) return

  const { error: erroInsert } = await supabase
    .from('perfil_permissao')
    .insert(grants.map((g) => ({ perfil_id: perfilId, modulo: g.modulo, permissao: g.permissao })))
  if (erroInsert) throw erroInsert
}
