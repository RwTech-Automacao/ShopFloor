'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { construirFluxo, type FluxoNodePos, type FluxoEdge, type PassagemPosto } from '@/modules/shopfloor/domain/fluxo-op'
import { carregarFluxoOp, carregarDetalhePosto, carregarSnsEmManutencao, type SnDoPosto } from '@/modules/shopfloor/infra/fluxo-repository'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

export async function carregarFluxo(
  pmo: string,
  op: string,
): Promise<{ ok: true; nodes: FluxoNodePos[]; edges: FluxoEdge[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const { postos, agregados, temStatus, recurso, exigeManutencao, qtd } = await carregarFluxoOp(pmo.trim(), op.trim())
    const { nodes, edges } = construirFluxo(
      postos,
      agregados,
      (p) => temStatus[p] ?? false,
      (p) => recurso[p] ?? 'nenhum',
      qtd,
      (p) => exigeManutencao[p] ?? false,
    )
    return { ok: true, nodes, edges }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o fluxo da OP.' }
  }
}

export async function detalhePosto(
  pmo: string,
  op: string,
  posto: string,
): Promise<{ ok: true; agora: SnDoPosto[]; historico: PassagemPosto[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const d = await carregarDetalhePosto(pmo.trim(), op.trim(), posto.trim())
    return { ok: true, agora: d.agora, historico: d.historico }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o detalhe do posto.' }
  }
}

/** SNs em Manutenção agora (último bipe reprovado) — detalhe do nó Manutenção, coerente com o WIP. */
export async function snsManutencao(
  pmo: string,
  op: string,
): Promise<{ ok: true; sns: SnDoPosto[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, sns: await carregarSnsEmManutencao(pmo.trim(), op.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as peças em manutenção.' }
  }
}
