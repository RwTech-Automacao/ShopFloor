import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/shared/lib/supabase/middleware'
import { ehRotaPublicaDeAlertas } from '@/modules/alertas/domain/rotas'

export async function middleware(request: NextRequest) {
  // Cron e webhooks dos alertas não têm sessão: quem autoriza é o segredo (cron/Telegram) ou a
  // assinatura Ed25519 (Discord), dentro da própria rota. Sem esta saída o middleware responderia
  // um redirect pro /login — e o Telegram trataria isso como entrega bem-sucedida.
  if (ehRotaPublicaDeAlertas(request.nextUrl.pathname)) return NextResponse.next()
  // O cron da fila de estoque (Compels) também não tem sessão: quem autoriza é o segredo, dentro da
  // própria rota (ver tools/estoque/README.md). Sem esta saída o middleware devolveria um redirect
  // pro /login, e o `curl` do crontab veria um 3xx — que não é erro nem para o `-f`: a fila nunca
  // sairia e o log diria que tudo correu bem.
  if (request.nextUrl.pathname === '/api/shopfloor/estoque') return NextResponse.next()
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
