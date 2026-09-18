import 'server-only'
import type { PortasCanais, RepositorioEnvios } from '../application/portas'
import { criarPortasCanais } from './canais'
import { criarRepositorioServico } from './repositorio-servico'

/** Dependências prontas para as rotas e as actions de servidor. */
export function criarDependenciasAlertas(): { portas: PortasCanais; repo: RepositorioEnvios } {
  return { portas: criarPortasCanais(), repo: criarRepositorioServico() }
}
