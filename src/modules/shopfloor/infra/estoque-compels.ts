import 'server-only'
import { semSufixo } from '@/modules/compels/domain/sem-sufixo'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { ConfiguracaoIncompleta, configDoAmbiente } from '@/modules/compels/infra/config'
import { saldoDisponivel, type SaldoEmEstoque } from '@/modules/compels/domain/saldo-por-estoque'
import type { EstoqueCompels } from '../domain/estoque-compels'
import { codigoDaLinha, ESTOQUE_PA, lerNota } from '@/modules/compels/domain/baixa-nf'

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
  listarNfsPendentes?(): Promise<Record<string, unknown>[]>
  itensDaNf?(idNota: number): Promise<{ proprias: unknown[] }>
}

/** Quantidade vendida em NF pendente de baixa, por código (sem sufixo, maiúsculo). Uma leitura para todos os itens. */
let cacheNfs: { ate: number; porCodigo: Map<string, number> } | null = null
const TTL_NFS_MS = 60_000

async function vendidoEmNfs(cliente: Consulta, agora: number): Promise<Map<string, number>> {
  if (cacheNfs && cacheNfs.ate > agora) return cacheNfs.porCodigo
  const porCodigo = new Map<string, number>()
  if (cliente.listarNfsPendentes && cliente.itensDaNf) {
    // Sem data de corte (spec 2026-11-17): TODAS as notas de saída pendentes de baixa.
    const notas = (await cliente.listarNfsPendentes()).map(lerNota).filter((n) => n !== null)
    for (const nota of notas) {
      for (const linha of (await cliente.itensDaNf(nota.id)).proprias) {
        const codigo = semSufixo(codigoDaLinha(linha)).toUpperCase()
        const qtd = (linha as { itemNotaICMS?: { quantidadeInterna?: unknown } }).itemNotaICMS?.quantidadeInterna
        if (codigo && typeof qtd === 'number') porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + qtd)
      }
    }
  }
  cacheNfs = { ate: agora + TTL_NFS_MS, porCodigo }
  return porCodigo
}

export interface DependenciasEstoque {
  /** Para teste. Em produção é o `ClienteCompels` (um só por processo, para reaproveitar o token). */
  cliente?: Consulta
  agora?: () => number
}

const cache = new Map<string, { ate: number; resultado: EstoqueCompels }>()
/**
 * As linhas de saldo por estoque de cada código, como o Compels devolveu. Compartilhado pelo card do Fluxo e
 * pela tela de Baixa de NF do Faturamento (estoque do PA por item): uma ida ao ERP serve os dois.
 */
const cacheSaldos = new Map<string, { ate: number; linhas: SaldoEmEstoque[] }>()
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
  cacheSaldos.clear()
  cacheNfs = null
  clienteDoProcesso = undefined
}

/** Saldo por estoque do código, do cache curto ou do Compels (com tempo-limite). Falha não fica guardada aqui. */
async function saldosDoItem(cliente: Consulta, codigo: string, agora: number): Promise<SaldoEmEstoque[]> {
  const chave = codigo.toUpperCase()
  const guardado = cacheSaldos.get(chave)
  if (guardado && guardado.ate > agora) return guardado.linhas
  const linhas = await Promise.race([
    cliente.consultarSaldoPorEstoque(codigo),
    new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error('tempo esgotado')), TIMEOUT_MS)),
  ])
  cacheSaldos.set(chave, { ate: agora + TTL_OK_MS, linhas })
  return linhas
}

/**
 * Saldo do item no estoque PA (tela de Baixa de NF). `null` = não deu para consultar (Compels fora ou não
 * configurado): a tela não inventa a falta.
 */
export async function buscarSaldoPa(codigo: string, deps: DependenciasEstoque = {}): Promise<number | null> {
  const c = codigo.trim()
  if (c === '') return null
  const cliente = deps.cliente ?? clientePadrao()
  if (!cliente) return null
  try {
    return saldoDisponivel(await saldosDoItem(cliente, c, (deps.agora ?? Date.now)()), [ESTOQUE_PA]).total
  } catch (e) {
    console.error('[estoque-compels] saldo do PA falhou:', e instanceof Error ? e.message : e)
    return null
  }
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
    const linhas = await saldosDoItem(cliente, codigo, agora)
    // Item sem saldo em nenhum estoque volta sem linhas: para o card isso é zero disponível.
    const { total, porEstoque } = saldoDisponivel(linhas)
    resultado = { tipo: 'ok', disponivel: total, porEstoque, consultadoEm: new Date(agora).toISOString() }
    // NFs vendidas sem baixa (todas as pendentes, sem data de corte). Falhar aqui não derruba o estoque — o
    // card só não mostra o desconto.
    try {
      resultado.vendidoEmNf = (await vendidoEmNfs(cliente, agora)).get(codigo.toUpperCase()) ?? 0
    } catch (e) {
      console.error('[estoque-compels] NFs pendentes falharam:', e instanceof Error ? e.message : e)
    }
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
