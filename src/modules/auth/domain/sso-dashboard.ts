/**
 * Claims do token de SSO do Dashboard Enterplak (iframe do Fluxo da OP).
 *
 * Como no SSO do Portal (sso-token.ts), ASSINATURA, `exp`, `iss` e `aud` são conferidos pela
 * biblioteca de JWT — aqui fica só o que ela não sabe: se o payload traz o que a integração exige.
 */
export interface ClaimsDashboard {
  email: string
  jti: string
}

export const EMISSOR_DASHBOARD = 'enterplak-dashboard'
export const AUDIENCIA_DASHBOARD = 'shopfloor-embed'

const normalizar = (v: unknown): string => String(v ?? '').trim().toLowerCase()

/**
 * Confere o que a biblioteca de JWT não cobre. `emailAceito` vem do env (DASHBOARD_SSO_EMAIL).
 *
 * O e-mail é COMPARADO, não só validado: o emissor só pode entrar com a conta compartilhada do
 * dashboard. É isso que impede um segredo vazado de virar acesso como outra pessoa.
 */
export function validarClaimsDashboard(
  bruto: Record<string, unknown>,
  emailAceito: string,
): { ok: true; claims: ClaimsDashboard } | { ok: false; erro: string } {
  const email = normalizar(bruto.email)
  if (email === '') return { ok: false, erro: 'Token sem e-mail.' }

  const aceito = normalizar(emailAceito)
  // Sem e-mail configurado não há o que comparar: recusa em vez de aceitar qualquer um.
  if (aceito === '' || email !== aceito) {
    return { ok: false, erro: 'Este emissor só pode entrar com a conta do dashboard.' }
  }

  // Sem `jti` não há como recusar repetição.
  const jti = String(bruto.jti ?? '').trim()
  if (jti === '') return { ok: false, erro: 'Token sem identificador (jti).' }

  return { ok: true, claims: { email, jti } }
}

const CONTROLE = /[\u0000-\u001f\u007f]/
const INVALIDO = { ok: false, erro: 'Destino inválido.' } as const

/**
 * O `next` só pode ser um caminho relativo dentro de /embed/. Vai direto num cabeçalho `Location`:
 * fugir de /embed/ seria open redirect; nova linha, resposta HTTP partida.
 * Devolve o valor COMO VEIO (ainda percent-encoded): a OP tem `/` no nome e precisa continuar
 * escapada no `Location`.
 */
export function validarNextEmbed(
  valor: unknown,
): { ok: true; next: string } | { ok: false; erro: string } {
  if (typeof valor !== 'string' || valor.trim() === '') return INVALIDO
  if (CONTROLE.test(valor)) return INVALIDO
  if (valor.startsWith('//') || valor.startsWith('/\\')) return INVALIDO
  if (!valor.startsWith('/embed/')) return INVALIDO

  // A travessia é conferida DEPOIS de decodificar: `/embed/..%2Fhome` escapa se só olhar o cru.
  let decodificado: string
  try {
    decodificado = decodeURIComponent(valor)
  } catch {
    return INVALIDO
  }
  if (CONTROLE.test(decodificado)) return INVALIDO
  if (decodificado.split(/[/\\]/).includes('..')) return INVALIDO

  return { ok: true, next: valor }
}
