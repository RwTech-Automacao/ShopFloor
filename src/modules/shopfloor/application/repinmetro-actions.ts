'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { buscarLogsPorSn, buscarTodosLogs, type LogRepinmetro } from '@/modules/shopfloor/infra/repinmetro-repository'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'
// Busca vazia (estudo/teste) traz os N mais recentes — teto pra não travar o navegador.
const LIMITE_TODOS = 500

/** Consulta os testes do repinmetro de um Nº de Série. Busca VAZIA = todos (limitado), só p/ estudo. */
export async function buscarLogsRepinmetro(
  sn: string,
): Promise<{ ok: true; logs: LogRepinmetro[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const logs = sn.trim() === '' ? await buscarTodosLogs(LIMITE_TODOS) : await buscarLogsPorSn(sn)
    return { ok: true, logs }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar os logs do repinmetro.' }
  }
}
