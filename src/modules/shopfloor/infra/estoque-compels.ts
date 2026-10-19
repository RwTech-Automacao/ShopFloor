import 'server-only'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { ConfiguracaoIncompleta, configDoAmbiente } from '@/modules/compels/infra/config'
import type { EstoqueCompels } from '../domain/estoque-compels'

/**
 * Estoque de uma PMO no Compels, consultado NA HORA e guardado só em memória por pouco tempo (decisão de
 * 16/10/2026: sem cópia no banco, porque o saldo muda por fora do ShopFloor). O cache evita uma ida ao ERP
 * a cada abertura do Fluxo; uma falha é lembrada por menos tempo ainda.
 */
export const TTL_OK_MS = 60_000
export const TTL_FALHA_MS = 15_000
const TIMEOUT_MS = 10_000

interface Consulta {
  consultarSaldoItem(codigo: string): Promise<{
    proprio: number
    unidade: string
    pendencia: number
    emTerceiros: number
    deTerceiros: number
  } | null>
}

export interface DependenciasEstoque {
  /** Para teste. Em produção é o `ClienteCompels` (um só por processo, para reaproveitar o token). */
  cliente?: Consulta
  agora?: () => number
}

const cache = new Map<string, { ate: number; resultado: EstoqueCompels }>()
let clienteDoProcesso: ClienteCompels | null | undefined

function clientePadrao(): ClienteCompels | null {
  if (clienteDoProcesso !== undefined) return clienteDoProcesso
  try {
    clienteDoProcesso = new ClienteCompels(configDoAmbiente())
  } catch (e) {
    if (!(e instanceof ConfiguracaoIncompleta)) throw e
    clienteDoProcesso = null
  }
  return clienteDoProcesso
}

/** Só para teste: esvazia o cache e o cliente do processo. */
export function limparEstoqueCompelsParaTeste(): void {
  cache.clear()
  clienteDoProcesso = undefined
}

export async function buscarEstoqueCompels(pmo: string, deps: DependenciasEstoque = {}): Promise<EstoqueCompels> {
  const codigo = pmo.trim()
  if (codigo === '') return { tipo: 'nao_encontrado' }
  const agora = (deps.agora ?? Date.now)()

  const guardado = cache.get(codigo.toUpperCase())
  if (guardado && guardado.ate > agora) return guardado.resultado

  const cliente = deps.cliente ?? clientePadrao()
  if (!cliente) return { tipo: 'nao_configurado' }

  let resultado: EstoqueCompels
  try {
    const saldo = await Promise.race([
      cliente.consultarSaldoItem(codigo),
      new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error('tempo esgotado')), TIMEOUT_MS)),
    ])
    resultado = saldo
      ? {
          tipo: 'ok',
          proprio: saldo.proprio,
          unidade: saldo.unidade,
          pendencia: saldo.pendencia,
          emTerceiros: saldo.emTerceiros,
          deTerceiros: saldo.deTerceiros,
          consultadoEm: new Date(agora).toISOString(),
        }
      : { tipo: 'nao_encontrado' }
  } catch (e) {
    // Sem detalhe para a tela (nunca vaza mensagem do ERP); o log do servidor guarda o motivo.
    console.error('[estoque-compels] consulta falhou:', e instanceof Error ? e.message : e)
    resultado = { tipo: 'indisponivel' }
  }

  cache.set(codigo.toUpperCase(), {
    ate: agora + (resultado.tipo === 'indisponivel' ? TTL_FALHA_MS : TTL_OK_MS),
    resultado,
  })
  return resultado
}
