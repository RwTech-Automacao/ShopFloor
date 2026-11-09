/**
 * A página do tablet do Almoxarifado (`GET /quiosque/fichas?k=<chave>`) NÃO passa pela sessão do app: o tablet
 * (Android 4.4) não tem login, e quem autoriza é a chave `FICHAS_TABLET_CHAVE`, conferida dentro da própria rota
 * (sem chave certa = 404). Ver domain/quiosque-fichas.ts.
 *
 * ⚠️ Sem esta saída no `middleware.ts` o tablet levaria um redirect pro /login.
 *
 * Tolera UMA barra final. É a rota EXATA: `/quiosque/fichas/x` e `/quiosque/fichasx` não são — rota nova sob o
 * mesmo prefixo nasce COM sessão.
 */
const ROTA_QUIOSQUE_FICHAS = '/quiosque/fichas'

export function ehRotaDoQuiosqueDeFichas(pathname: string): boolean {
  return pathname === ROTA_QUIOSQUE_FICHAS || pathname === `${ROTA_QUIOSQUE_FICHAS}/`
}
