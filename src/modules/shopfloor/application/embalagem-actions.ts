'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { marcadorCaixaAberta } from '@/modules/shopfloor/domain/caixa'
import { carregarEstadoEmbalagem, garantirCaixa, chamarFecharCaixa, type EstadoEmbalagem } from '@/modules/shopfloor/infra/caixa-repository'
import { lancar } from './lancar-action'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

export async function carregarEmbalagem(
  pmo: string, op: string, posto: string,
): Promise<{ ok: true; estado: EstadoEmbalagem } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, estado: await carregarEstadoEmbalagem(pmo.trim(), op.trim(), posto.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o estado da caixa.' }
  }
}

/** Garante a caixa (seq,limite) e lança a peça nela (reusa sf_lancar via lancar). */
export async function embalarPeca(entrada: {
  colaborador: string; pmo: string; op: string; posto: string; seq: number; limite: number; numeroSerie: string
}): Promise<{ ok: true; caixaCount?: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    await garantirCaixa(entrada.pmo.trim(), entrada.op.trim(), entrada.posto.trim(), entrada.seq, entrada.limite)
  } catch {
    return { ok: false, erro: 'Não foi possível abrir a caixa.' }
  }
  const r = await lancar({
    colaborador: entrada.colaborador,
    posto: entrada.posto,
    pmo: entrada.pmo,
    op: entrada.op,
    numeroSerie: entrada.numeroSerie,
    numeroCaixa: marcadorCaixaAberta(entrada.seq),
    qtdPorCaixa: String(entrada.limite),
  })
  if (!r.ok) return r
  return { ok: true, caixaCount: r.caixaCount }
}

export async function fecharCaixa(
  pmo: string, op: string, posto: string, seq: number, ultima: boolean,
): Promise<{ ok: true; codigo: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  const r = await chamarFecharCaixa(pmo.trim(), op.trim(), posto.trim(), seq, ultima)
  if (!r.ok) return { ok: false, erro: r.erro === 'CAIXA_VAZIA' ? 'A caixa está vazia.' : 'Não foi possível fechar a caixa.' }
  return { ok: true, codigo: r.codigo! }
}
