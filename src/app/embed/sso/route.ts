import { NextResponse } from 'next/server'
import { entrarPorSsoDashboard, type CodigoSsoDashboard } from '@/modules/auth/application/sso-dashboard'

/**
 * Entrada de SSO do Dashboard Enterplak: `GET /embed/sso?token=<JWT>&next=<caminho>`.
 *
 * É por aqui que o iframe do dashboard entra: o dashboard assina um token de 60 segundos, aponta o
 * `src` do iframe para cá, e esta rota abre a sessão da conta compartilhada no cookie do embed e
 * redireciona para a tela do Fluxo.
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
  const r = await entrarPorSsoDashboard(searchParams.get('token'), searchParams.get('next'))

  if (!r.ok) {
    // Falha vira TELA, não JSON: quem chega aqui é um iframe dentro do dashboard, e um objeto JSON
    // cru não diz nada a quem está olhando a aba. A página também avisa o pai por postMessage.
    return new NextResponse(paginaDeErro(r.erro, r.codigo), {
      status: r.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  // ⚠️ O `next` vai CRU, exatamente como `validarNextEmbed` o devolveu (ainda percent-encoded).
  // NÃO passar por `new URL`, `decodeURIComponent` nem normalização nenhuma: a OP do ShopFloor tem
  // `/` no nome (2340/26) e precisa continuar escapada; e o duplo encoding (`/embed/%252e%252e/…`)
  // só é inofensivo porque ninguém o decodifica de novo — um decode a mais viraria travessia.
  //
  // Location RELATIVO, de propósito. Atrás do nginx o Next enxerga a requisição chegando em
  // 127.0.0.1:3000 — o domínio público só existe no cabeçalho `Host` —, então montar a URL a partir
  // de `request.url` mandaria o iframe pra localhost. (Relativo é válido desde a RFC 7231.)
  return new NextResponse(null, {
    status: 307,
    headers: { Location: r.next, 'Cache-Control': 'no-store' },
  })
}

/**
 * O Next auto-implementa HEAD a partir do GET, o que queimaria o token e abriria sessão com o corpo
 * descartado — um scanner de link ou antivírus que fizesse HEAD gastaria o token do dashboard.
 * Endpoint que executa ação não responde a HEAD executando a ação.
 */
export async function HEAD() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } })
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escaparHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)

/** JSON dentro de `<script>`: o `<` escapado impede que um valor com `</script>` feche a tag. */
const paraScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/**
 * Página mínima de falha, em PT-BR, com o aviso ao pai.
 *
 * ⚠️ PROVISÓRIO: a ponte de `postMessage` é da Task 4 (`src/app/embed/embed-ponte.tsx`). Quando ela
 * existir, este `<script>` inline sai e a página passa a usar o componente de ponte — aqui está só
 * o mínimo para o dashboard não ficar esperando um iframe mudo.
 *
 * `targetOrigin` é a origem do dashboard, lida do env; sem ela, NÃO se manda mensagem (nunca `*`,
 * que entregaria o aviso a qualquer página que estivesse nos embutindo).
 */
function paginaDeErro(erro: string, codigo: CodigoSsoDashboard | null): string {
  const origem = process.env.DASHBOARD_ORIGIN ?? ''
  const ponte =
    origem === ''
      ? ''
      : `<script>try{window.parent.postMessage(${paraScript({
          type: 'sf-embed:error',
          code: codigo,
        })},${paraScript(origem)})}catch(e){}</script>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Fluxo da OP</title>
<style>
body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;
font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0}
main{max-width:34rem;padding:2rem;text-align:center}
h1{font-size:1.1rem;margin:0 0 .5rem}
p{margin:0;font-size:.95rem;color:#94a3b8}
</style>
</head>
<body>
<main>
<h1>Não foi possível abrir o Fluxo da OP</h1>
<p>${escaparHtml(erro)}</p>
</main>
${ponte}
</body>
</html>`
}
