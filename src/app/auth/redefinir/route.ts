import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createServerSupabase } from '@/shared/lib/supabase/server'

/**
 * Callback do link de recuperação de senha. O e-mail do Supabase leva pra cá com
 * `?token_hash=...&type=recovery`. Verificamos o token (verifyOtp) — server-side, funciona em
 * qualquer navegador/aparelho, sem depender de cookie do PKCE — e mandamos pra página de nova
 * senha. Falha/expirado volta pro início.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  if (tokenHash && type) {
    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(`${origin}/redefinir-senha`)
  }
  return NextResponse.redirect(`${origin}/esqueci-senha?erro=expirado`)
}
