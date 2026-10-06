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

/** O que vai em `cookieOptions` do createServerClient quando é embed; nada quando não é. */
export function opcoesCookieEmbed(
  ehEmbed: boolean,
): { name: string; path: string } | undefined {
  return ehEmbed ? { name: COOKIE_EMBED, path: PREFIXO_EMBED } : undefined
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
  const copia = new Headers(cabecalhos)
  if (ehCaminhoEmbed(pathname)) copia.set(CABECALHO_EMBED, '1')
  else copia.delete(CABECALHO_EMBED)
  return copia
}
