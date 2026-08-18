import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/shared/lib/supabase/server'

/**
 * Callback do link de recuperação de senha. O e-mail do Supabase leva pra cá com `?code=...`.
 * Trocamos o code por uma sessão (recuperação) — só funciona em Route Handler, onde os cookies
 * são mutáveis — e mandamos pra página de definir a nova senha. Falha/expirado volta pro início.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (code) {
    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}/redefinir-senha`)
  }
  return NextResponse.redirect(`${origin}/esqueci-senha?erro=expirado`)
}
