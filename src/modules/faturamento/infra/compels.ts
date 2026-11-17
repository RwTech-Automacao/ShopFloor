import 'server-only'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { ConfiguracaoIncompleta, configDoAmbiente } from '@/modules/compels/infra/config'

let clienteDoProcesso: ClienteCompels | null | undefined

/** Um `ClienteCompels` por processo (reaproveita o token). `null` = o login do Compels não está neste ambiente. */
export function clienteCompelsDoFaturamento(): ClienteCompels | null {
  if (clienteDoProcesso !== undefined) return clienteDoProcesso
  try {
    clienteDoProcesso = new ClienteCompels(configDoAmbiente())
  } catch (e) {
    if (!(e instanceof ConfiguracaoIncompleta)) throw e
    clienteDoProcesso = null
  }
  return clienteDoProcesso
}
