'use server'

import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/shared/lib/supabase/server'

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
