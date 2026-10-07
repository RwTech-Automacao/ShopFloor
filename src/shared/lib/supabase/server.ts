import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { CABECALHO_EMBED, opcoesCookieEmbed } from './embed'

export async function createServerSupabase() {
  const cookieStore = await cookies()
  // Qual cookie de sessão vale vem da marca que o middleware injeta pelo caminho (/embed/* usa o
  // cookie da conta compartilhada). Assim os repositórios continuam chamando
  // createServerSupabase() sem argumento — são dezenas.
  const cabecalhos = await headers()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: opcoesCookieEmbed(cabecalhos.get(CABECALHO_EMBED) === '1'),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // chamado de Server Component sem resposta mutável — ignorado
          }
        },
      },
    },
  )
}
