import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/shared/lib/supabase/middleware'
import { ehRotaPublicaDeAlertas } from '@/modules/alertas/domain/rotas'
import { ehRotaPublicaDaCentral } from '@/modules/central/domain/rotas'
import { ehRotaDeDadosDoDashboard } from '@/modules/shopfloor/domain/rotas-dashboard'
import { ehRotaDaFilaDeEstoque } from '@/modules/shopfloor/domain/rotas-estoque'
import { cabecalhosComMarcaEmbed } from '@/shared/lib/supabase/embed'

export async function middleware(request: NextRequest) {
  // A marca de embed (x-sf-embed) diz ao createServerSupabase qual cookie de sessão usar. Ela é
  // decidida AQUI, pelo caminho: injetada em /embed/*, apagada em qualquer outro — mesmo que o
  // cliente a tenha mandado (ver cabecalhosComMarcaEmbed).
  const cabecalhos = cabecalhosComMarcaEmbed(request.headers, request.nextUrl.pathname)

  // Rotas que não têm sessão: quem autoriza é o segredo (cron/Telegram), a assinatura Ed25519
  // (Discord) ou o Bearer, dentro da própria rota. Sem esta saída o middleware responderia um
  // redirect pro /login — e o Telegram trataria isso como entrega bem-sucedida, enquanto o `curl -f`
  // de um cron veria um 3xx, que não é erro: a tarefa falharia toda vez sem ninguém perceber.
  // A fila de estoque do Compels (/api/shopfloor/estoque) e a sincronização da Central do Cliente são o mesmo caso.
  //
  // ⚠️ TODAS passam pelos `cabecalhos`, nunca por um NextResponse.next() pelado: é aqui que a marca
  // de embed mandada pelo cliente é apagada. Uma rota que saia sem eles aceita a marca forjada e
  // deixa o createServerSupabase usar o cookie da conta compartilhada do dashboard.
  if (
    ehRotaPublicaDeAlertas(request.nextUrl.pathname) ||
    ehRotaDeDadosDoDashboard(request.nextUrl.pathname) ||
    ehRotaPublicaDaCentral(request.nextUrl.pathname) ||
    ehRotaDaFilaDeEstoque(request.nextUrl.pathname)
  )
    return NextResponse.next({ request: { headers: cabecalhos } })

  return updateSession(request, cabecalhos)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
