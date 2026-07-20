import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { createServiceSupabase } from '@/shared/lib/supabase/service'

export interface PerfilResumo {
  id: string
  nome: string
  pode_administrar: boolean
}

export interface UsuarioRow {
  id: string
  nome: string
  email: string
  ativo: boolean
  perfis: PerfilResumo
}

export interface DadosAtualizarUsuario {
  nome: string
  perfilId: string
  ativo: boolean
}

/**
 * Cria a conta de autenticação via API admin (service-role). O trigger
 * `handle_new_user` cria automaticamente a linha correspondente em
 * `usuarios` (com perfil "Consulta") — a camada de aplicação deve, em
 * seguida, chamar `atualizarUsuario` para ajustar nome/perfil/ativo.
 */
export async function criarUsuarioAuth(input: {
  email: string
  password: string
  nome: string
}): Promise<{ id: string }> {
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { nome: input.nome },
  })
  if (error) throw error
  if (!data.user) throw new Error('Falha ao criar usuário.')
  return { id: data.user.id }
}

export async function atualizarSenha(id: string, password: string): Promise<void> {
  const supabase = createServiceSupabase()
  const { error } = await supabase.auth.admin.updateUserById(id, { password })
  if (error) throw error
}

/**
 * Exclui a conta de autenticação. Usado para desfazer (rollback) um
 * cadastro que falhou após a criação do usuário no Supabase Auth — evita
 * contas órfãs capazes de logar sem terem passado pela configuração de
 * nome/perfil.
 */
export async function excluirUsuarioAuth(id: string): Promise<void> {
  const supabase = createServiceSupabase()
  const { error } = await supabase.auth.admin.deleteUser(id)
  if (error) throw error
}

export async function listarUsuarios(): Promise<UsuarioRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,nome,email,ativo,perfis(id,nome,pode_administrar)')
    .order('nome')
  if (error) throw error
  return data as unknown as UsuarioRow[]
}

export async function buscarUsuario(id: string): Promise<UsuarioRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('usuarios')
    .select('id,nome,email,ativo,perfis(id,nome,pode_administrar)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as UsuarioRow | null) ?? null
}

export async function atualizarUsuario(
  id: string,
  dados: DadosAtualizarUsuario,
): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('usuarios')
    .update({ nome: dados.nome, perfil_id: dados.perfilId, ativo: dados.ativo })
    .eq('id', id)
  if (error) throw error
}

/**
 * Resolve um conjunto de ids de `usuarios` para seus nomes — usado para
 * exibir "quem fez X" (ex.: responsável recebimento/qualidade de um
 * processo) sem expor um objeto completo de usuário. Ids não encontrados
 * simplesmente não aparecem no mapa retornado.
 */
export async function buscarNomesUsuarios(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const supabase = createServiceSupabase()
  const { data, error } = await supabase.from('usuarios').select('id, nome').in('id', ids)
  if (error) throw error
  const nomes: Record<string, string> = {}
  for (const row of (data ?? []) as { id: string; nome: string }[]) {
    nomes[row.id] = row.nome
  }
  return nomes
}

/**
 * Liga/desliga a marca de "senha provisória". `false` = a pessoa já definiu a
 * própria senha; `true` = o gestor resetou e ela terá de trocar no próximo
 * acesso. Via service-role porque o operador comum não tem `administrar` e
 * ainda assim precisa limpar a própria marca ao trocar a senha.
 */
export async function definirSenhaProvisoria(id: string, valor: boolean): Promise<void> {
  const supabase = createServiceSupabase()
  const { error } = await supabase.from('usuarios').update({ senha_provisoria: valor }).eq('id', id)
  if (error) throw error
}
