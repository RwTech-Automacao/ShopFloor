'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { ehEtapa } from '../domain/etapa-processo'
import { consultarRegistros, type RegistroRecebimento } from '../infra/registros-repository'
import {
  carregarFluxoEmb,
  carregarHistoricoEtapa,
  carregarItensCaixa,
  type CaixaFluxo,
  type ItemFluxo,
  type PassagemEtapa,
} from '../infra/fluxo-repository'

export type ResultadoFluxo = { ok: true; caixas: CaixaFluxo[] } | { ok: false; erro: string }
export type ResultadoItens = { ok: true; itens: ItemFluxo[] } | { ok: false; erro: string }
export type ResultadoHistorico =
  | { ok: true; linhas: PassagemEtapa[]; temMais: boolean }
  | { ok: false; erro: string }
export type ResultadoHistoricoItem =
  | { ok: true; linhas: RegistroRecebimento[] }
  | { ok: false; erro: string }

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

/**
 * Histórico de uma etapa: quem passou por ela e quando. Paginado (o painel busca +100 conforme
 * rola), no molde do histórico do posto do Fluxo do ShopFloor. Somente leitura.
 */
export async function carregarHistoricoEtapaAction(
  emb: string,
  etapa: string,
  offset: number,
): Promise<ResultadoHistorico> {
  if (!await podeVer()) return { ok: false, erro: 'Você não tem permissão para ver o fluxo do Recebimento.' }
  const alvo = emb.trim()
  if (!alvo) return { ok: false, erro: 'Escolha uma EMB.' }
  if (!ehEtapa(etapa)) return { ok: false, erro: 'Etapa inválida.' }
  const inicio = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  try {
    const { linhas, total } = await carregarHistoricoEtapa(alvo, etapa, inicio)
    return { ok: true, linhas, temMais: inicio + linhas.length < total }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o histórico da etapa agora.' }
  }
}

/** Teto de passagens de um item. Um processo com mais de 200 eventos é anomalia, não uso normal. */
const MAX_PASSAGENS_ITEM = 200

/**
 * A trilha de UM processo — o que abre ao clicar num item do histórico da etapa.
 *
 * Reaproveita a `rec_registros` (0124) em vez de pedir função nova ao banco: ela já devolve
 * `processo_id` e a passagem derivada. O filtro dela é por item, e o MESMO item pode ter dois
 * processos na mesma EMB (aconteceu na EMB390CA: `CON445 #382` e `#383`), então o processo é
 * escolhido aqui, pelo id — nunca pelo código do item.
 *
 * Vem do banco na ordem do mais recente para o mais antigo e é devolvido assim: é a ordem que a
 * tela mostra, a mesma do histórico do SN no ShopFloor.
 */
export async function carregarHistoricoItemAction(
  emb: string,
  item: string,
  processoId: string,
): Promise<ResultadoHistoricoItem> {
  if (!await podeVer()) return { ok: false, erro: 'Você não tem permissão para ver o fluxo do Recebimento.' }
  const alvoEmb = emb.trim()
  const alvoItem = item.trim()
  if (!alvoEmb || !processoId.trim()) return { ok: false, erro: 'Item inválido.' }
  try {
    const { linhas } = await consultarRegistros(
      alvoItem ? { emb: alvoEmb, item: alvoItem } : { emb: alvoEmb },
      0,
      MAX_PASSAGENS_ITEM,
    )
    return { ok: true, linhas: linhas.filter((l) => l.processoId === processoId) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o histórico do item agora.' }
  }
}
