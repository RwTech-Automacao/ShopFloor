'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { resumoTrechosDaOp, type ResumoTrecho } from '../infra/estrutura-repository'

/** Resumo por trecho (PRT) da OP para o card do Fluxo. Sem sessão ou sem permissão de ver, devolve vazio. */
export async function lerTrechosCompelsAction(pmo: string, op: string): Promise<ResumoTrecho[]> {
  const s = await getSessao()
  if (!s || !podeNoModulo(s.perfil, 'shopfloor', 'visualizar')) return []
  try { return await resumoTrechosDaOp(String(pmo ?? ''), String(op ?? '')) } catch { return [] }
}
