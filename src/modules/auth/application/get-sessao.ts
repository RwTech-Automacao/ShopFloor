import { buscarUsuarioAutenticado } from '../infra/usuario-repository'
import type { Perfil } from '../domain/perfil'

export interface Sessao {
  usuarioId: string
  nome: string
  email: string
  perfil: Perfil
}

export async function getSessao(): Promise<Sessao | null> {
  return buscarUsuarioAutenticado()
}
