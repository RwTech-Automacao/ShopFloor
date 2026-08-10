'use server'

import { createServerClient } from '@supabase/ssr'
import { mapearPerfil, type PerfilRow } from '@/modules/auth/domain/mapear-perfil'

export type ResultadoKiosk = { ok: true } | { ok: false; erro: string }

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const semCookies = { cookies: { getAll: () => [], setAll: () => {} } } // client isolado → não mexe na sessão do operador

/**
 * Valida um supervisor (login + permissão `administrar`) pra liberar a saída do modo quiosque,
 * SEM trocar a sessão do operador logado no terminal. A senha é conferida pelo auth oficial num
 * client isolado; o perfil é lido com o token do próprio supervisor (RLS: lê a própria linha).
 */
export async function validarSupervisorKiosk(email: string, senha: string): Promise<ResultadoKiosk> {
  const e = email.trim().toLowerCase()
  if (e === '' || senha === '') return { ok: false, erro: 'Informe e-mail e senha.' }

  const auth = createServerClient(URL, ANON, semCookies)
  const { data: login, error } = await auth.auth.signInWithPassword({ email: e, password: senha })
  if (error || !login.user || !login.session) return { ok: false, erro: 'E-mail ou senha inválidos.' }

  const comToken = createServerClient(URL, ANON, {
    ...semCookies,
    global: { headers: { Authorization: `Bearer ${login.session.access_token}` } },
  })
  const { data, error: e2 } = await comToken
    .from('usuarios')
    .select('ativo, perfis(*, perfil_permissao(modulo,permissao))')
    .eq('id', login.user.id)
    .single()
  await auth.auth.signOut().catch(() => {})

  if (e2 || !data || !data.ativo || !data.perfis) return { ok: false, erro: 'Usuário sem acesso ao sistema.' }
  const perfil = mapearPerfil(data.perfis as unknown as PerfilRow)
  if (perfil.permissoes.administrar !== true) {
    return { ok: false, erro: 'Este usuário não tem permissão de supervisor.' }
  }
  return { ok: true }
}
