'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { buscarLogsPorSn, type LogRepinmetro } from '@/modules/shopfloor/infra/repinmetro-repository'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

/** Consulta os testes do repinmetro de um Nº de Série (produto final). */
export async function buscarLogsRepinmetro(
  sn: string,
): Promise<{ ok: true; logs: LogRepinmetro[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  if (sn.trim() === '') return { ok: true, logs: [] }
  try {
    return { ok: true, logs: await buscarLogsPorSn(sn) }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar os logs do repinmetro.' }
  }
}
