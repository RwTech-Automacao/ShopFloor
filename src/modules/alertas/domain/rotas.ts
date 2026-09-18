/**
 * Rotas dos alertas que NÃO passam pela sessão do app: o cron autentica por segredo e os webhooks
 * por segredo (Telegram) / assinatura Ed25519 (Discord). Sem esta exceção o middleware devolveria
 * um redirect pro /login — e o Telegram interpretaria isso como entrega feita.
 */
export function ehRotaPublicaDeAlertas(pathname: string): boolean {
  return pathname === '/api/alertas' || pathname.startsWith('/api/alertas/')
}
