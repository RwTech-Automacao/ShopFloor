import { NextResponse } from 'next/server'
import { entrarPorSso } from '@/modules/auth/application/sso-portal'

/**
 * Entrada de SSO do Portal RwTech: `GET /sso?token=<JWT>`.
 *
 * O token vai na QUERY STRING, então ele passa por log de nginx, histórico do navegador e qualquer
 * proxy no meio. Por isso nada aqui loga a URL, e o token vale 60 segundos e uma única vez — o que
 * vazar já terá sido queimado.
 *
 * `dynamic = 'force-dynamic'`: a resposta depende da query e grava cookies de sessão; cache aqui
 * serviria a sessão de uma pessoa para a próxima.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const r = await entrarPorSso(searchParams.get('token'))

  if (!r.ok) {
    // Falha vira TELA, não JSON: quem chega aqui é uma pessoa que clicou num link no portal, e um
    // objeto JSON cru na tela não diz a ela o que fazer. O status vai no corpo pra depuração.
    return NextResponse.json({ error: r.erro }, { status: r.status })
  }

  // Location RELATIVO, de propósito. Atrás do nginx o Next enxerga a requisição chegando em
  // 127.0.0.1:3000 — o domínio público só existe no cabeçalho `Host` —, então montar a URL a partir
  // de `request.url` mandaria a pessoa pra localhost. Um caminho relativo o navegador resolve
  // contra o endereço que ele já está usando, sem depender de header nenhum nem de configuração
  // do proxy. (É válido desde a RFC 7231.)
  return new NextResponse(null, { status: 307, headers: { Location: '/home' } })
}
