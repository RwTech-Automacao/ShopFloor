import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/shared/lib/supabase/middleware'
import { ehRotaPublicaDeAlertas } from '@/modules/alertas/domain/rotas'

export async function middleware(request: NextRequest) {
  // Cron e webhooks dos alertas não têm sessão: quem autoriza é o segredo (cron/Telegram) ou a
  // assinatura Ed25519 (Discord), dentro da própria rota. Sem esta saída o middleware responderia
  // um redirect pro /login — e o Telegram trataria isso como entrega bem-sucedida.
  if (ehRotaPublicaDeAlertas(request.nextUrl.pathname)) return NextResponse.next()
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
