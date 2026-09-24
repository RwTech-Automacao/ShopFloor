'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { ehEtapa } from '../domain/etapa-processo'
import {
  carregarFluxoEmb,
  carregarItensCaixa,
  type CaixaFluxo,
  type ItemFluxo,
} from '../infra/fluxo-repository'

export type ResultadoFluxo = { ok: true; caixas: CaixaFluxo[] } | { ok: false; erro: string }
export type ResultadoItens = { ok: true; itens: ItemFluxo[] } | { ok: false; erro: string }

/** O gate se repete em toda server action (a tela já checa, mas a action é chamável direto). */
async function podeVer(): Promise<boolean> {
  const sessao = await getSessao()
  return !!sessao && podeNoModulo(sessao.perfil, 'recebimento', 'visualizar')
}

/** As quatro caixas de uma EMB: quantos itens em cada uma, divergentes e tempo. Somente leitura. */
export async function carregarFluxoEmbAction(emb: string): Promise<ResultadoFluxo> {
  if (!await podeVer()) return { ok: false, erro: 'Você não tem permissão para ver o fluxo do Recebimento.' }
  const alvo = emb.trim()
  if (!alvo) return { ok: false, erro: 'Escolha uma EMB.' }
  try {
    return { ok: true, caixas: await carregarFluxoEmb(alvo) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o fluxo agora.' }
  }
}

/** Os itens de uma caixa (o que abre ao clicar nela). Somente leitura. */
export async function carregarItensCaixaAction(emb: string, etapa: string): Promise<ResultadoItens> {
  if (!await podeVer()) return { ok: false, erro: 'Você não tem permissão para ver o fluxo do Recebimento.' }
  const alvo = emb.trim()
  if (!alvo) return { ok: false, erro: 'Escolha uma EMB.' }
  if (!ehEtapa(etapa)) return { ok: false, erro: 'Etapa inválida.' }
  try {
    return { ok: true, itens: await carregarItensCaixa(alvo, etapa) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar os itens da etapa agora.' }
  }
}
