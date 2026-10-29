import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createServerSupabase } from '@/shared/lib/supabase/server'

/**
 * Callback do link de recuperação de senha. O e-mail do Supabase leva pra cá com
 * `?token_hash=...&type=recovery`. Verificamos o token (verifyOtp) — server-side, funciona em
 * qualquer navegador/aparelho, sem depender de cookie do PKCE — e mandamos pra página de nova
 * senha. Falha/expirado volta pro início.
 *
 * Redirect com `Location` RELATIVO (sem `origin`): atrás do nginx, `new URL(request.url).origin`
 * vira `localhost:3000`. Mesma solução do SSO.
 */
function redirecionar(destino: string) {
  return new NextResponse(null, { status: 307, headers: { Location: destino } })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  if (tokenHash && type) {
    const supabase = await createServerSupabase()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return redirecionar('/redefinir-senha')
  }
  return redirecionar('/esqueci-senha?erro=expirado')
}
