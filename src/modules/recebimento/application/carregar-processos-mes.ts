'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import {
  listarProcessosDoMes,
  type FiltrosProcessos,
  type ProcessoResumoRow,
} from '../infra/processo-repository'

export type ResultadoProcessosMes =
  | { ok: true; linhas: ProcessoResumoRow[] }
  | { ok: false; erro: string }

/**
 * Carrega sob demanda as linhas de um grupo (mês 'YYYY-MM' ou 'sem_data')
 * quando o usuário abre o accordion. Exige `visualizar`; o RLS é o portão real.
 */
export async function carregarProcessosDoMes(
  filtros: FiltrosProcessos,
  chave: string,
): Promise<ResultadoProcessosMes> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para visualizar processos.' }
  }
  try {
    const linhas = await listarProcessosDoMes(filtros, chave)
    return { ok: true, linhas }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar os processos deste mês.' }
  }
}
