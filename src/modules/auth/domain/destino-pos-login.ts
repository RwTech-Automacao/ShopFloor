/**
 * Para onde mandar a pessoa depois do login.
 *
 * Quem abre um link do sistema sem sessão (ex.: o link de um alerta no Discord/e-mail) é mandado ao
 * /login com o destino em `?next=`. Esse valor vem da URL — qualquer um pode montar um link
 * `/login?next=https://site-falso` —, então ele só é aceito se for um caminho RELATIVO INTERNO.
 * Qualquer outra coisa vira /home (open redirect).
 */
export const PARAM_DESTINO = 'next'
export const DESTINO_PADRAO = '/home'

/** Acima disso o destino é descartado: o Location vira cabeçalho no nginx (que já estourou buffer). */
const TAMANHO_MAXIMO = 2048

export function destinoPosLogin(valor: unknown): string {
  if (typeof valor !== 'string' || valor === '' || valor.length > TAMANHO_MAXIMO) return DESTINO_PADRAO
  // Só caminho absoluto do próprio site: começa com UMA barra. "//host" é URL de outro domínio
  // (scheme-relative) e, sem barra inicial, entra esquema (`https:`, `javascript:`) ou caminho relativo.
  if (!valor.startsWith('/') || valor.startsWith('//')) return DESTINO_PADRAO
  // Navegadores tratam "\" como "/" ("/\evil.com" = "//evil.com") e REMOVEM tab/quebra de linha da
  // URL ("/\t/evil.com" = "//evil.com"). Nenhum caminho legítimo do app tem nenhum dos dois.
  if (valor.includes('\\') || /[\u0000-\u001f\u007f]/.test(valor)) return DESTINO_PADRAO
  // Voltar ao /login depois de entrar seria um laço.
  const caminho = valor.split(/[?#]/, 1)[0] ?? ''
  if (caminho === '/login' || caminho.startsWith('/login/')) return DESTINO_PADRAO
  return valor
}
