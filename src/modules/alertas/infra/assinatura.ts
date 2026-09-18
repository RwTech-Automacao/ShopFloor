import { createPublicKey, timingSafeEqual, verify } from 'node:crypto'

/**
 * O Discord publica a chave pública do app como 32 bytes crus em hexadecimal. O `node:crypto` só
 * importa chave estruturada, então a gente prefixa o cabeçalho SPKI de Ed25519 (12 bytes fixos) e
 * entrega o DER pronto — sem biblioteca nenhuma.
 */
const PREFIXO_SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex')

const RE_HEX_32 = /^[0-9a-f]{64}$/i
const RE_HEX_64 = /^[0-9a-f]{128}$/i

/** A assinatura cobre `timestamp + corpo cru` — por isso a rota lê o corpo como texto. */
export function verificarAssinaturaDiscord(
  chavePublicaHex: string,
  assinaturaHex: string | null,
  timestamp: string | null,
  corpo: string,
): boolean {
  if (!assinaturaHex || !timestamp) return false
  if (!RE_HEX_32.test(chavePublicaHex) || !RE_HEX_64.test(assinaturaHex)) return false
  try {
    const chave = createPublicKey({
      key: Buffer.concat([PREFIXO_SPKI_ED25519, Buffer.from(chavePublicaHex, 'hex')]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, Buffer.from(timestamp + corpo), chave, Buffer.from(assinaturaHex, 'hex'))
  } catch {
    return false
  }
}

/** Compara segredos em tempo constante (cron e webhook do Telegram). */
export function segredoConfere(recebido: string | null | undefined, esperado: string): boolean {
  if (!esperado || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}
