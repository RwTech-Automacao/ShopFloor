#!/usr/bin/env node
// gen-supabase-keys.mjs — gera as chaves do Supabase self-hosted.
// Rode: node deploy/aws/gen-supabase-keys.mjs
// Copie as 3 linhas de saída pro .env do Supabase (JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY).
// NÃO comite esse resultado nem cole no chat — são segredos.

import crypto from 'node:crypto'

const b64url = (input) => Buffer.from(input).toString('base64url')

function signHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

// JWT secret: string aleatória forte (Supabase pede >= 32 chars).
const jwtSecret = crypto.randomBytes(40).toString('base64url')

const iat = Math.floor(Date.now() / 1000)
const exp = iat + 60 * 60 * 24 * 365 * 10 // 10 anos

const anonKey = signHS256({ role: 'anon', iss: 'supabase', iat, exp }, jwtSecret)
const serviceKey = signHS256({ role: 'service_role', iss: 'supabase', iat, exp }, jwtSecret)

console.log('# ==== cole no .env do Supabase (NÃO comitar / NÃO colar no chat) ====')
console.log('JWT_SECRET=' + jwtSecret)
console.log('ANON_KEY=' + anonKey)
console.log('SERVICE_ROLE_KEY=' + serviceKey)
console.log('# ===================================================================')
console.log('# ANON_KEY também vai no app como NEXT_PUBLIC_SUPABASE_ANON_KEY')
console.log('# SERVICE_ROLE_KEY também vai no app como SUPABASE_SERVICE_ROLE_KEY')
