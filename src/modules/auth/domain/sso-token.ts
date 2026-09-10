/**
 * Claims do token de SSO do Portal RwTech.
 *
 * A ASSINATURA e os claims temporais (`exp`, `iss`, `aud`) são conferidos pela biblioteca de JWT —
 * não se reimplementa criptografia à mão. O que sobra pra cá é o que a biblioteca não sabe: se o
 * payload traz o que a integração precisa. Um token com assinatura perfeita e sem `email` é um
 * token válido e inútil, e o erro tem que ser claro em vez de estourar mais adiante.
 */
export interface ClaimsSso {
  email: string
  jti: string
  sub: string
  name: string
}

const EMAIL_RAZOAVEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Confere o formato dos claims que a validação de assinatura não cobre.
 * Devolve os campos já normalizados (e-mail em minúsculas e sem espaços) para a busca do usuário.
 */
export function validarClaimsSso(
  bruto: Record<string, unknown>,
): { ok: true; claims: ClaimsSso } | { ok: false; erro: string } {
  const email = String(bruto.email ?? '').trim().toLowerCase()
  if (email === '') return { ok: false, erro: 'Token sem e-mail.' }
  if (!EMAIL_RAZOAVEL.test(email)) return { ok: false, erro: 'Token com e-mail inválido.' }

  // Sem `jti` não há como recusar repetição — e aceitar seria abrir mão do anti-replay em silêncio.
  const jti = String(bruto.jti ?? '').trim()
  if (jti === '') return { ok: false, erro: 'Token sem identificador (jti).' }

  return {
    ok: true,
    claims: { email, jti, sub: String(bruto.sub ?? '').trim(), name: String(bruto.name ?? '').trim() },
  }
}

/**
 * Registro dos `jti` já usados, para recusar o mesmo token duas vezes.
 *
 * Em memória porque o Shopfloor roda em UM processo (pm2 fork). Se um dia virarem várias
 * instâncias, isto precisa sair pra uma tabela — cada processo teria a sua lista e o replay
 * passaria pela instância que ainda não viu o token.
 *
 * A janela de risco é limitada pelo próprio `exp` de 60s: sem esta trava, um token capturado só
 * valeria por um minuto; com ela, não vale nem uma segunda vez dentro dele.
 */
export class RegistroJti {
  private readonly vistos = new Map<string, number>()

  /** Marca o jti. `false` = já tinha sido usado (replay). */
  registrar(jti: string, expiraEmMs: number, agoraMs: number = Date.now()): boolean {
    this.limpar(agoraMs)
    if (this.vistos.has(jti)) return false
    this.vistos.set(jti, expiraEmMs)
    return true
  }

  /** Descarta os que já passaram da validade — o mapa não pode crescer para sempre. */
  private limpar(agoraMs: number): void {
    for (const [jti, expira] of this.vistos) if (expira <= agoraMs) this.vistos.delete(jti)
  }

  get tamanho(): number {
    return this.vistos.size
  }
}
