/**
 * O segredo compartilhado (CENTRAL_SYNC_SECRET) vai em texto claro no cabeçalho `Authorization`.
 * Por https tudo bem; por http só quando o destino é a própria máquina (teste local com a Central
 * rodando em outra porta) — fora disso o segredo viajaria em texto claro pela internet.
 */
// `.hostname` do WHATWG URL mantém colchetes em endereços IPv6 (`new URL('http://[::1]').hostname === '[::1]'`).
const HOSTS_LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function centralUrlSegura(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && HOSTS_LOOPBACK.has(u.hostname)
}
