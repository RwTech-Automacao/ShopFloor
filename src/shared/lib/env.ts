type RawEnv = Record<string, string | undefined>

export interface AppEnv {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export function parseEnv(raw: RawEnv): AppEnv {
  const url = raw.NEXT_PUBLIC_SUPABASE_URL
  const anon = raw.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = raw.SUPABASE_SERVICE_ROLE_KEY

  const faltando: string[] = []
  if (!url) faltando.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!anon) faltando.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!service) faltando.push('SUPABASE_SERVICE_ROLE_KEY')
  if (faltando.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${faltando.join(', ')}`)
  }

  return {
    SUPABASE_URL: url!,
    SUPABASE_ANON_KEY: anon!,
    SUPABASE_SERVICE_ROLE_KEY: service!,
  }
}

export const env: AppEnv = parseEnv(process.env as RawEnv)
