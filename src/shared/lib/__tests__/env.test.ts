import { describe, it, expect } from 'vitest'
import { parseEnv } from '../env'

describe('parseEnv', () => {
  it('retorna as variáveis quando todas presentes', () => {
    const result = parseEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    })
    expect(result.SUPABASE_URL).toBe('https://x.supabase.co')
    expect(result.SUPABASE_ANON_KEY).toBe('anon')
  })

  it('lança erro quando falta uma variável obrigatória', () => {
    expect(() =>
      parseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' }),
    ).toThrow(/SUPABASE_ANON_KEY/)
  })
})
