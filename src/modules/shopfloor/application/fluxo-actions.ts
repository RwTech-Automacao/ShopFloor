'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { construirFluxo, type FluxoNodePos, type FluxoEdge, type PassagemPosto } from '@/modules/shopfloor/domain/fluxo-op'
import { carregarFluxoOp, carregarTemposFluxo, carregarDetalhePosto, carregarSnsEmManutencao, carregarBurninDetalhe, carregarEmbalagemCaixas, type SnDoPosto, type BurninDetalhe, type EmbalagemCaixa } from '@/modules/shopfloor/infra/fluxo-repository'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

export async function carregarFluxo(
  pmo: string,
  op: string,
): Promise<{ ok: true; nodes: FluxoNodePos[]; edges: FluxoEdge[]; qtd: number | null } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const [fluxo, tempos] = await Promise.all([
      carregarFluxoOp(pmo.trim(), op.trim()),
      carregarTemposFluxo(pmo.trim(), op.trim()),
    ])
    const { postos, agregados, temStatus, recurso, exigeManutencao, qtd, naoIniciadas, finalizadas } = fluxo
    const { nodes, edges } = construirFluxo(
      postos,
      agregados,
      (p) => temStatus[p] ?? false,
      (p) => recurso[p] ?? 'nenhum',
      qtd,
      (p) => exigeManutencao[p] ?? false,
      naoIniciadas,
      finalizadas,
    )
    // Anexa o tempo típico (mediana, segundos) nas arestas de CADEIA (origem→destino).
    const edgesComTempo = edges.map((e) =>
      e.tipo === 'fluxo' ? { ...e, segundos: tempos[`${e.source}||${e.target}`] } : e,
    )
    return { ok: true, nodes, edges: edgesComTempo, qtd }
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

/** Detalhe do nó Burn-in: cozinhando agora (ciclo aberto) + eventos de entrada e de saída. */
export async function burninDetalhe(
  pmo: string,
  op: string,
  posto: string,
): Promise<{ ok: true; detalhe: BurninDetalhe } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, detalhe: await carregarBurninDetalhe(pmo.trim(), op.trim(), posto.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o detalhe do Burn-in.' }
  }
}

/** Peças embaladas + a caixa de cada uma — detalhe do nó Embalagem. */
export async function embalagemCaixas(
  pmo: string,
  op: string,
  posto: string,
): Promise<{ ok: true; itens: EmbalagemCaixa[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, itens: await carregarEmbalagemCaixas(pmo.trim(), op.trim(), posto.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as caixas da Embalagem.' }
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
