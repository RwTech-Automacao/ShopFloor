import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/shared/lib/supabase/middleware'
import { ehRotaPublicaDeAlertas } from '@/modules/alertas/domain/rotas'
import { ehRotaDeDadosDoDashboard } from '@/modules/shopfloor/domain/rotas-dashboard'
import { ehRotaDaFilaDeEstoque } from '@/modules/shopfloor/domain/rotas-estoque'
import { ehRotaDoQuiosqueDeFichas } from '@/modules/shopfloor/domain/rotas-quiosque'
import { ehRotaDaBaixaDeNf } from '@/modules/compels/domain/rotas-baixa-nf'
import { ehRotaDoManifestoDaBaixaNf } from '@/modules/faturamento/domain/app-baixa-nf'
import { ehRotaDaSincronizacaoSat } from '@/modules/sat/domain/rotas-sat'
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
  // A fila de estoque do Compels (/api/shopfloor/estoque) é o mesmo caso — ver tools/estoque/README.md.
  // A página do tablet do Almoxarifado (/quiosque/fichas) também: quem autoriza é a chave do link
  // (FICHAS_TABLET_CHAVE); sem ela a rota responde 404.
  // O manifesto do app "Baixa de NF" (/faturamento/manifest.webmanifest) também: o navegador o busca sem cookie.
  // A cópia da planilha do SAT (/api/sat/sincronizar-planilha) é cron: autoriza o ESTOQUE_CRON_SECRET na rota.
  //
  // ⚠️ TODAS passam pelos `cabecalhos`, nunca por um NextResponse.next() pelado: é aqui que a marca
  // de embed mandada pelo cliente é apagada. Uma rota que saia sem eles aceita a marca forjada e
  // deixa o createServerSupabase usar o cookie da conta compartilhada do dashboard.
  if (
    ehRotaPublicaDeAlertas(request.nextUrl.pathname) ||
    ehRotaDeDadosDoDashboard(request.nextUrl.pathname) ||
    ehRotaDaFilaDeEstoque(request.nextUrl.pathname) ||
    ehRotaDoQuiosqueDeFichas(request.nextUrl.pathname) ||
    ehRotaDaBaixaDeNf(request.nextUrl.pathname) ||
    ehRotaDoManifestoDaBaixaNf(request.nextUrl.pathname) ||
    ehRotaDaSincronizacaoSat(request.nextUrl.pathname)
  )
    return NextResponse.next({ request: { headers: cabecalhos } })

  return updateSession(request, cabecalhos)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)'],
}
