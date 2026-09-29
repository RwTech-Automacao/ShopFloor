/**
 * Rota da sincronização com a Central do Cliente que NÃO passa pela sessão do app: o cron
 * autentica por segredo dentro da própria rota. Sem esta exceção o middleware devolveria um
 * redirect (307) pro /login — e o `curl -f` do cron não acusa isso como erro, então a
 * sincronização falharia silenciosamente hora após hora.
 *
 * Casamento EXATO (não startsWith): é uma única rota, não um prefixo com sub-rotas como os
 * Alertas. `/api/central/sincronizar/` (barra final) NÃO é a mesma rota.
 */
export function ehRotaPublicaDaCentral(pathname: string): boolean {
  return pathname === '/api/central/sincronizar'
}
