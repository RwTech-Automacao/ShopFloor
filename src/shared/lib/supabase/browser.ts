import { createBrowserClient } from '@supabase/ssr'

/**
 * ⚠️ NÃO use dentro de `/embed`. Este cliente NÃO conhece o embed: lê e escreve o cookie PADRÃO em
 * `Path=/`, e sobrescreveria a sessão do supervisor logado — o bug que o cookie próprio do embed
 * (`sf-embed-auth`, ver embed.ts) existe para evitar. Hoje não é usado em lugar nenhum.
 */
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
