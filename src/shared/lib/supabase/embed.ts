/**
 * FONTE ÚNICA do que é "embed".
 *
 * A tela do Fluxo embutida no Dashboard roda sob `/embed/*` com a conta compartilhada só-leitura.
 * Essa sessão NÃO pode sobrescrever o cookie do supervisor logado no ShopFloor em outra aba do
 * mesmo navegador — por isso `/embed/*` grava a sessão num cookie próprio, e as rotas normais
 * seguem no cookie de sempre.
 *
 * Duas partes decidindo "isto é embed?" por caminhos ligeiramente diferentes é a família de
 * defeito que já custou várias correções neste projeto: o prefixo, o nome do cookie e a marca
 * ficam SÓ aqui, e o middleware e o `createServerSupabase` importam daqui.
 */

export const PREFIXO_EMBED = '/embed'
/** Marca que o middleware injeta na requisição para dizer qual cookie de sessão vale. */
export const CABECALHO_EMBED = 'x-sf-embed'
export const COOKIE_EMBED = 'sf-embed-auth'

/** `/embed` e tudo abaixo dele. `/embedx` NÃO é embed. */
export function ehCaminhoEmbed(pathname: string): boolean {
  return pathname === PREFIXO_EMBED || pathname.startsWith(`${PREFIXO_EMBED}/`)
}

/**
 * O que vai em `cookieOptions` do createServerClient quando é embed; nada quando não é.
 *
 * - `httpOnly: true` SEMPRE: nada no cliente lê esse cookie (a tela busca tudo por Server Action).
 *   Sem isso, quem abrisse o dashboard leria o token no devtools e poderia recolocá-lo com o
 *   nome padrão em `Path=/`, navegando o ShopFloor inteiro como a conta compartilhada. O
 *   cabeçalho `x-sf-embed` protege contra o ENVIO automático do cookie, não contra quem LÊ o valor.
 * - `secure` só em produção: lá o servidor já manda HSTS. Em dev, sobre `http://localhost`, um
 *   `secure: true` fixo faria o navegador REJEITAR o cookie e o embed não funcionaria.
 * - `sameSite` fica `lax` (default do @supabase/ssr), que é o correto: dashboard.enterplak.com.br
 *   e shopfloor.enterplak.com.br são cross-origin mas SAME-SITE. NÃO usar `none`.
 *
 * `producao` é parâmetro para a decisão ser testável sem mexer em `NODE_ENV`.
 */
export function opcoesCookieEmbed(
  ehEmbed: boolean,
  producao: boolean = process.env.NODE_ENV === 'production',
): { name: string; path: string; httpOnly: boolean; secure: boolean } | undefined {
  return ehEmbed
    ? { name: COOKIE_EMBED, path: PREFIXO_EMBED, httpOnly: true, secure: producao }
    : undefined
}

/**
 * Cópia dos cabeçalhos da requisição com a marca de embed decidida PELO CAMINHO: presente em
 * `/embed/*`, apagada em qualquer outro — inclusive quando o cliente a mandou na mão.
 *
 * ⚠️ A marca diz onde a requisição está; não é um pedido do cliente. Sem o apagamento, quem
 * tivesse o cookie da conta compartilhada mandaria o cabeçalho numa rota normal e navegaria o app
 * inteiro como a conta do dashboard.
 */
export function cabecalhosComMarcaEmbed(cabecalhos: Headers, pathname: string): Headers {
  // ⚠️ A defesa depende de o middleware SEMPRE devolver `x-middleware-override-headers` NÃO vazio.
  // Se esta cópia ficasse sem nenhuma chave, o Next gravaria a lista como string vazia e os
  // cabeçalhos CRUS do cliente passariam inteiros (resolve-routes.js:413), reabrindo o buraco.
  // É inalcançável na prática (`host` sempre vem), mas NÃO "otimize" a cópia nem filtre chaves.
  const copia = new Headers(cabecalhos)
  if (ehCaminhoEmbed(pathname)) copia.set(CABECALHO_EMBED, '1')
  else copia.delete(CABECALHO_EMBED)
  return copia
}
