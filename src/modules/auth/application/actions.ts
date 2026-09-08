'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { validarForcaSenha } from '@/modules/usuarios/domain/senha'

export async function entrar(
  _prev: { erro?: string } | undefined,
  formData: FormData,
): Promise<{ erro?: string }> {
  const email = String(formData.get('email') ?? '')
  const senha = String(formData.get('senha') ?? '')

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
  if (error) {
    return { erro: 'Usuário ou senha inválidos.' }
  }
  redirect('/home')
}

export async function sair(): Promise<void> {
  const supabase = await createServerSupabase()
  // scope 'local': desloga só ESTE aparelho (não revoga a sessão do mesmo usuário em outros terminais).
  await supabase.auth.signOut({ scope: 'local' })
  redirect('/login')
}

/**
 * "Esqueci minha senha": envia o e-mail de recuperação (link cai em /auth/redefinir → /redefinir-senha).
 * Resposta SEMPRE genérica — não revela se o e-mail existe (evita enumeração de contas).
 */
export async function solicitarReset(email: string): Promise<{ ok: true } | { erro: string }> {
  const alvo = email.trim()
  if (alvo === '') return { erro: 'Informe o e-mail.' }
  const h = await headers()
  const origin = h.get('origin') ?? `https://${h.get('host') ?? ''}`
  const supabase = await createServerSupabase()
  // Erro (rate-limit etc.) é engolido de propósito: a resposta não muda pra não vazar existência.
  await supabase.auth.resetPasswordForEmail(alvo, { redirectTo: `${origin}/auth/redefinir` })
  return { ok: true }
}

/**
 * Define a nova senha usando a sessão de recuperação (criada pelo link do e-mail em /auth/redefinir).
 * Ao final, encerra a sessão de recuperação — o usuário volta pro Login e entra com a nova senha.
 */
export async function redefinirSenha(nova: string): Promise<{ ok: true } | { erro: string }> {
  const forca = validarForcaSenha(nova)
  if (!forca.ok) return { erro: forca.erro! }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: 'Link inválido ou expirado. Solicite um novo.' }

  const { error } = await supabase.auth.updateUser({ password: nova })
  if (error) return { erro: 'Não foi possível redefinir a senha. Tente novamente.' }

  await supabase.auth.signOut() // encerra a sessão de recuperação → login com a nova senha
  return { ok: true }
}
