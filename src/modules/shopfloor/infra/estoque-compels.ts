import 'server-only'
import { semSufixo } from '@/modules/compels/domain/sem-sufixo'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { ConfiguracaoIncompleta, configDoAmbiente } from '@/modules/compels/infra/config'
import { saldoDisponivel, type SaldoEmEstoque } from '@/modules/compels/domain/saldo-por-estoque'
import type { EstoqueCompels } from '../domain/estoque-compels'

/**
 * Estoque de uma PMO no Compels, consultado NA HORA e guardado só em memória por pouco tempo (decisão de
 * 16/10/2026: sem cópia no banco, porque o saldo muda por fora do ShopFloor). O cache evita uma ida ao ERP
 * a cada abertura do Fluxo; uma falha é lembrada por menos tempo ainda.
 */
export const TTL_OK_MS = 15_000
export const TTL_FALHA_MS = 15_000
const TIMEOUT_MS = 10_000

interface Consulta {
  consultarSaldoPorEstoque(codigo: string): Promise<SaldoEmEstoque[]>
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
  // PMO de segunda leva (PMOF52_F) é o MESMO item do Compels (PMOF52): o sufixo só existe no ShopFloor.
  const codigo = semSufixo(pmo)
  if (codigo === '') return { tipo: 'nao_encontrado' }
  const agora = (deps.agora ?? Date.now)()

  const guardado = cache.get(codigo.toUpperCase())
  if (guardado && guardado.ate > agora) return guardado.resultado

  const cliente = deps.cliente ?? clientePadrao()
  if (!cliente) return { tipo: 'nao_configurado' }

  let resultado: EstoqueCompels
  try {
    const linhas = await Promise.race([
      cliente.consultarSaldoPorEstoque(codigo),
      new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error('tempo esgotado')), TIMEOUT_MS)),
    ])
    // Item sem saldo em nenhum estoque volta sem linhas: para o card isso é zero disponível.
    const { total, porEstoque } = saldoDisponivel(linhas)
    resultado = { tipo: 'ok', disponivel: total, porEstoque, consultadoEm: new Date(agora).toISOString() }
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
