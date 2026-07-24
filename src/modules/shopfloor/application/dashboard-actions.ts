'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { contarPorPosto } from '../domain/dashboard'
import { carregarOrdem } from '../infra/lancamento-repository'
import { listarContagemDaOp } from '../infra/dashboard-repository'

export interface ItemDashboard {
  posto: string
  contagem: number
}

export async function carregarDashboard(
  pmo: string,
  op: string,
  de?: string,
  ate?: string,
): Promise<{ ok: true; itens: ItemDashboard[]; total: number | null } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para ver o dashboard.' }
  }
  const ordem = await carregarOrdem(pmo.trim(), op.trim())
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }
  try {
    const registros = await listarContagemDaOp(pmo.trim(), op.trim(), de || undefined, ate || undefined)
    const contagens = contarPorPosto(ordem.postos, registros)
    const itens = [...ordem.postos, 'Manutenção'].map((posto) => ({ posto, contagem: contagens[posto] ?? 0 }))
    return { ok: true, itens, total: ordem.qtd }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o dashboard.' }
  }
}
