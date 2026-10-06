/**
 * A API de dados do Dashboard Enterplak (`/api/dashboard/*`) NÃO passa pela sessão do app: quem
 * autoriza é o segredo `DASHBOARD_API_SECRET`, conferido dentro da própria rota em tempo constante.
 *
 * ⚠️ Sem esta saída no `middleware.ts` a rota nunca executaria: o matcher do middleware cobre
 * `/api/*`, e `GET /api/dashboard/ops-ativas?dias=30` responderia 307 para `/login?dias=30` — o
 * dashboard receberia HTML de tela de login em vez da lista de OPs, e um 401 jamais aconteceria.
 *
 * É função IRMÃ da `ehRotaPublicaDeAlertas`, de propósito: rota de dashboard dentro de uma função
 * que diz "alertas" é mentira que vira defeito na próxima leitura.
 *
 * ⚠️ Isto libera o PREFIXO. Toda rota nova sob `/api/dashboard/` nasce sem sessão e PRECISA
 * autenticar por segredo (ou outra prova) por conta própria.
 */
const PREFIXO_API_DASHBOARD = '/api/dashboard'

/** `/api/dashboard` e tudo abaixo dele. `/api/dashboardx` NÃO é. */
export function ehRotaDeDadosDoDashboard(pathname: string): boolean {
  return pathname === PREFIXO_API_DASHBOARD || pathname.startsWith(`${PREFIXO_API_DASHBOARD}/`)
}
