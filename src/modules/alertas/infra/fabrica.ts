import 'server-only'
import type { PortasCanais, RepositorioEnvios, RepositorioVinculo } from '../application/portas'
import { criarPortasCanais } from './canais'
import { criarRepositorioServico } from './repositorio-servico'

/** Dependências prontas para as rotas (cron e webhooks) e para as actions de servidor. */
export function criarDependenciasAlertas(): {
  portas: PortasCanais
  repo: RepositorioEnvios & RepositorioVinculo
} {
  return { portas: criarPortasCanais(), repo: criarRepositorioServico() }
}
