import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '../env'

/** Client com service role — USAR SOMENTE em código server confiável. Ignora RLS. */
export function createServiceSupabase() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
