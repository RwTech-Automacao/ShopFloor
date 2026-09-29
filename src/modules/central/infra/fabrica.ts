import 'server-only'
import type { EnviadorFoto, LeitorFoto } from '../application/portas'
import { criarLeitorServico } from './leitura'
import { criarEnviadorHttp } from './envio'

/**
 * Dependências prontas pra rota do cron. A rota confere `CENTRAL_SYNC_URL`/`CENTRAL_SYNC_SECRET`
 * (e o `CENTRAL_SYNC_CRON_SECRET`, que não entra aqui — é só da autorização) ANTES de chamar isto,
 * então aqui já pode assumir as duas variáveis presentes.
 */
export function criarDependenciasCentral(): { leitor: LeitorFoto; enviador: EnviadorFoto } {
  const url = process.env.CENTRAL_SYNC_URL ?? ''
  const segredo = process.env.CENTRAL_SYNC_SECRET ?? ''
  return { leitor: criarLeitorServico(), enviador: criarEnviadorHttp(url, segredo) }
}
