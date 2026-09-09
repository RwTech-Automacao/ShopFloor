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
  const { searchParams, origin } = new URL(request.url)
  const r = await entrarPorSso(searchParams.get('token'))

  if (!r.ok) {
    // Falha vira TELA, não JSON: quem chega aqui é uma pessoa que clicou num link no portal, e um
    // objeto JSON cru na tela não diz a ela o que fazer. O status vai no corpo pra depuração.
    return NextResponse.json({ error: r.erro }, { status: r.status })
  }

  return NextResponse.redirect(`${origin}/home`)
}
