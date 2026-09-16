'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import {
  buscarIntegracoesRep,
  buscarLogs,
  listarModelos,
  type IntegracaoRep,
  type LogRepinmetro,
} from '@/modules/shopfloor/infra/repinmetro-repository'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'
// Busca vazia (estudo/teste) traz os N mais recentes — teto pra não travar o navegador.
const LIMITE_TODOS = 500

/** Consulta testes do repinmetro por Nº de Série e/ou Modelo. SN vazio = todos (limitado), só p/ estudo. */
export async function buscarLogsRepinmetro(
  sn: string,
  modelo = '',
): Promise<{ ok: true; logs: LogRepinmetro[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, logs: await buscarLogs({ sn, modelo, limite: LIMITE_TODOS }) }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar os logs do repinmetro.' }
  }
}

/** Modelos existentes (pro filtro suspenso). */
export async function listarModelosRepinmetro(): Promise<string[]> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return []
  try {
    return await listarModelos()
  } catch {
    return []
  }
}

/** Integração do REP (teste de produção): busca pelo produto final (REP) ou pelo serial de uma peça. */
export async function buscarIntegracaoRepinmetro(
  por: 'rep' | 'peca',
  termo: string,
  modelo = '',
): Promise<{ ok: true; integracoes: IntegracaoRep[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  if (termo.trim() === '') return { ok: false, erro: 'Bipe ou digite o número de série.' }
  try {
    return { ok: true, integracoes: await buscarIntegracoesRep({ por: por === 'peca' ? 'peca' : 'rep', termo, modelo }) }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar a integração do repinmetro.' }
  }
}
