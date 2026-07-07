import { createServerSupabase } from '@/shared/lib/supabase/server'
import { mapearPerfil, type PerfilRow } from '../domain/mapear-perfil'
import type { Perfil } from '../domain/perfil'

export interface UsuarioComPerfil {
  usuarioId: string
  nome: string
  email: string
  perfil: Perfil
}

export async function buscarUsuarioAutenticado(): Promise<UsuarioComPerfil | null> {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nome, email, ativo, perfis(*)')
    .eq('id', user.id)
    .single()

  if (error || !data || !data.ativo || !data.perfis) return null

  return {
    usuarioId: data.id,
    nome: data.nome,
    email: data.email,
    perfil: mapearPerfil(data.perfis as unknown as PerfilRow),
  }
}
