'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { buscarLogs, listarModelos, type LogRepinmetro } from '@/modules/shopfloor/infra/repinmetro-repository'

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
