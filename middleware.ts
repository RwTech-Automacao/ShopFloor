import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/shared/lib/supabase/middleware'
import { ehRotaPublicaDeAlertas } from '@/modules/alertas/domain/rotas'
import { cabecalhosComMarcaEmbed } from '@/shared/lib/supabase/embed'

export async function middleware(request: NextRequest) {
  // A marca de embed (x-sf-embed) diz ao createServerSupabase qual cookie de sessão usar. Ela é
  // decidida AQUI, pelo caminho: injetada em /embed/*, apagada em qualquer outro — mesmo que o
  // cliente a tenha mandado (ver cabecalhosComMarcaEmbed).
  const cabecalhos = cabecalhosComMarcaEmbed(request.headers, request.nextUrl.pathname)

  // Cron e webhooks dos alertas não têm sessão: quem autoriza é o segredo (cron/Telegram) ou a
  // assinatura Ed25519 (Discord), dentro da própria rota. Sem esta saída o middleware responderia
  // um redirect pro /login — e o Telegram trataria isso como entrega bem-sucedida.
  if (ehRotaPublicaDeAlertas(request.nextUrl.pathname))
    return NextResponse.next({ request: { headers: cabecalhos } })

  return updateSession(request, cabecalhos)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
