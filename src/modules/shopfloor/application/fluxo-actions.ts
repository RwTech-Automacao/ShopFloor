'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { construirFluxo, type FluxoNodePos, type FluxoEdge, type PassagemPosto } from '@/modules/shopfloor/domain/fluxo-op'
import { carregarFluxoOp, carregarDetalhePosto, carregarSnsEmManutencao, carregarBurninDetalhe, carregarEmbalagemCaixas, rotaDoSn, carregarFluxoPeriodo, type SnDoPosto, type BurninDetalhe, type EmbalagemCaixa } from '@/modules/shopfloor/infra/fluxo-repository'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

export async function carregarFluxo(
  pmo: string,
  op: string,
): Promise<{ ok: true; nodes: FluxoNodePos[]; edges: FluxoEdge[]; qtd: number | null } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const fluxo = await carregarFluxoOp(pmo.trim(), op.trim())
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
    // Onda 3: o tempo na aresta agora é a CADÊNCIA (min/peça), calculada no cliente a partir do período.
    return { ok: true, nodes, edges, qtd }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o fluxo da OP.' }
  }
}

export interface PeriodoContagem { registros: number; aprovadas: number; reprovadas: number }

/** Produção por posto em 1+ faixas de tempo (somadas). Ex.: Dia = matutino + vespertino. */
export async function fluxoPeriodo(
  pmo: string,
  op: string,
  faixas: { ini: string; fim: string }[],
): Promise<{ ok: true; postos: Record<string, PeriodoContagem> } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const acc: Record<string, PeriodoContagem> = {}
    for (const f of faixas) {
      const rows = await carregarFluxoPeriodo(pmo.trim(), op.trim(), f.ini, f.fim)
      for (const r of rows) {
        const a = acc[r.posto] ?? { registros: 0, aprovadas: 0, reprovadas: 0 }
        a.registros += r.registros; a.aprovadas += r.aprovadas; a.reprovadas += r.reprovadas
        acc[r.posto] = a
      }
    }
    return { ok: true, postos: acc }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar a produção do período.' }
  }
}

export async function rotaSn(
  pmo: string,
  op: string,
  sn: string,
): Promise<{ ok: true; postos: string[]; atual: string | null } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  const alvo = normalizarSerie(sn)
  if (alvo === '') return { ok: true, postos: [], atual: null }
  try {
    const r = await rotaDoSn(pmo.trim(), op.trim(), alvo)
    return { ok: true, postos: r.postos, atual: r.atual }
  } catch {
    return { ok: false, erro: 'Não foi possível buscar a rota do SN.' }
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
