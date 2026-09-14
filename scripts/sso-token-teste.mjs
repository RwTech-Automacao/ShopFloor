/**
 * Gera um token de SSO de teste, assinado como o Portal RwTech assinaria.
 *
 * Serve pra validar o endpoint /sso SEM depender do portal — dá pra fechar o ciclo inteiro
 * (assinatura, claims, anti-replay, sessão) antes de a integração existir do outro lado.
 *
 *   node scripts/sso-token-teste.mjs seu.email@rwtech.com.br
 *   node scripts/sso-token-teste.mjs seu.email@rwtech.com.br http://localhost:3000
 *
 * Lê RWTECH_SSO_SECRET e RWTECH_SITE_ID do ambiente (ou do .env.local, se existir).
 * Usa `jose`, que já é dependência do projeto — não precisa instalar mais nada.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'

// Carrega o .env.local sem depender de biblioteca: só as linhas CHAVE=valor que interessam.
function doEnvLocal(chave) {
  if (process.env[chave]) return process.env[chave]
  try {
    for (const linha of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linha)
      if (m && m[1] === chave) return m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* sem .env.local, segue com o ambiente */ }
  return ''
}

const email = process.argv[2]
const base = process.argv[3] ?? 'http://localhost:3000'
if (!email) {
  console.error('Uso: node scripts/sso-token-teste.mjs <email cadastrado no Shopfloor> [url base]')
  process.exit(1)
}

const segredo = doEnvLocal('RWTECH_SSO_SECRET')
const siteId = doEnvLocal('RWTECH_SITE_ID')
if (!segredo || !siteId) {
  console.error('Faltam RWTECH_SSO_SECRET e/ou RWTECH_SITE_ID (no ambiente ou no .env.local).')
  process.exit(1)
}

// Os MESMOS 60s de vida do portal: se o token de teste durasse mais, o teste não provaria nada
// sobre a janela real — e é justamente ela que costuma falhar por relógio dessincronizado.
const agora = Math.floor(Date.now() / 1000)
const token = await new SignJWT({
  sub: 'teste-local',
  email,
  name: 'Teste Local',
  role: 'MEMBER',
  jti: randomUUID(),
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuer('rwtech-portal')
  .setAudience(siteId)
  .setIssuedAt(agora)
  .setExpirationTime(agora + 60)
  // Bytes UTF-8 da string, igual ao `jsonwebtoken` com secret string — é assim que o endpoint lê.
  .sign(new TextEncoder().encode(segredo))

console.log(`\n${base}/sso?token=${token}\n`)
console.log('Vale por 60 segundos e UMA vez só (anti-replay). Rode de novo pra outro teste.')
