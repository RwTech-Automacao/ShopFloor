/**
 * EDIÇÃO DE OP COM TRECHOS (0184/0194). Regras puras da página /shopfloor/ordens-nova/[id].
 *
 * A página grava a OP inteira por trecho (sf_ordem_regravar_trechos, 0194): a rota de cada trecho, a série das PRTs e
 * as faixas de todos. O banco recusa o que mudaria o histórico (posto com registro trocando de trecho; PRT já bipada ou
 * apontada trocando o posto final ou a série, ou com faixa que deixa SN usado de fora) — a tela só mostra a mensagem.
 */
import type { OpEspelho } from '@/modules/compels/domain/espelho-ops'
import { faixasDaPmoDoBanco, faixasDoBanco, type FaixaSN } from './faixas-sn'
import type { SnModo, TipoTrecho, TrechoCadastro } from './cadastro-op'

export interface TrechoGravado { seq: number; codigo: string; tipo: TipoTrecho; compels_op: string | null; sn_modo: SnModo }
export interface PostoGravado { posto: string; ordem: number; trecho_seq: number | null }
export interface FaixaGravada { seq: number; sn_ini: string; sn_fim: string; trecho_seq?: number | null }

/**
 * Os trechos da OP gravada, no formato da tela (o mesmo da Nova OP). Posto sem trecho_seq conta como da PMO (é onde
 * a sf_ordem_regravar_postos o poria). Quantidade e situação vêm do espelho do Compels, quando a OP filha está lá.
 */
export function trechosDaOpGravada(
  trechos: TrechoGravado[],
  postos: PostoGravado[],
  faixas: FaixaGravada[],
  espelho: OpEspelho[] = [],
): TrechoCadastro[] {
  const ordenados = [...trechos].sort((a, b) => a.seq - b.seq)
  const pmoSeq = ordenados.find((t) => t.tipo === 'pmo')?.seq ?? null
  const rota = [...postos].sort((a, b) => a.ordem - b.ordem)
  const doEspelho = new Map(espelho.map((o) => [String(o.numero), o]))
  return ordenados.map((t) => {
    const e = t.compels_op ? doEspelho.get(t.compels_op) : undefined
    const daPmo = t.tipo === 'pmo'
    const f = daPmo
      ? faixasDaPmoDoBanco(faixas, ordenados)
      : faixasDoBanco(faixas.filter((x) => x.trecho_seq === t.seq))
    return {
      seq: t.seq,
      codigo: t.codigo,
      tipo: t.tipo,
      compelsOp: t.compels_op,
      descricao: e?.descricao ?? '',
      quantidade: e ? e.quantidade : null,
      situacao: e?.situacao ?? '',
      snModo: daPmo ? 'mesmo' : t.sn_modo,
      postos: rota.filter((p) => (p.trecho_seq ?? pmoSeq) === t.seq).map((p) => p.posto),
      // A PMO sempre mostra ao menos uma faixa (vazia) para editar; a PRT mostra só o que tem.
      faixas: daPmo && f.length === 0 ? [{ sn_ini: '', sn_fim: '' }] : f,
    }
  })
}

/** Os postos que já estão na rota gravada (posto de Burn-in que entra pela edição ganha o tempo padrão). */
export function postosGravados(trechos: TrechoCadastro[]): Set<string> {
  return new Set(trechos.flatMap((t) => t.postos))
}

/** Postos que o "Adicionar posto" do trecho oferece: os fora da rota; o Almoxarifado nunca numa PRT. */
export function postosParaAdicionar(catalogo: string[], trechos: TrechoCadastro[], t: TrechoCadastro, almoxarifado: string | null): string[] {
  const usados = new Set(trechos.flatMap((x) => x.postos))
  return catalogo.filter((p) => !usados.has(p) && !(t.tipo === 'prt' && p === almoxarifado))
}

/** O que vai no campo `trechos` da edição: rota, série e faixas por trecho (PRT 'mesmo' sem faixa; PMO sempre 'mesmo'). */
export function trechosParaGravar(trechos: TrechoCadastro[]): { seq: number; postos: string[]; sn_modo: SnModo; faixas: FaixaSN[] }[] {
  return trechos.map((t) => {
    const snModo: SnModo = t.tipo === 'pmo' ? 'mesmo' : t.snModo
    return { seq: t.seq, postos: t.postos, sn_modo: snModo, faixas: t.tipo === 'pmo' || snModo === 'proprio' ? t.faixas : [] }
  })
}

/** A rota inteira na ordem dos trechos: é o `fluxo` que a edição grava. */
export function rotaDosTrechos(trechos: TrechoCadastro[]): string[] {
  return trechos.flatMap((t) => t.postos)
}

/** As faixas da PMO (o `faixas` que a edição grava): as do trecho da PMO. */
export function faixasDaPmo(trechos: TrechoCadastro[]): FaixaSN[] {
  return trechos.find((t) => t.tipo === 'pmo')?.faixas ?? []
}

/** A receita só dos postos de Integração da rota, sem lista vazia (o que vai para sf_ordem_componentes). */
export function receitaDaRota(rota: string[], receita: Record<string, string[]>, ehIntegracao: (posto: string) => boolean): Record<string, string[]> {
  return Object.fromEntries(rota.filter((p) => ehIntegracao(p) && (receita[p]?.length ?? 0) > 0).map((p) => [p, receita[p]!]))
}

/** Os tempos de Burn-in (hhh:mm) só dos postos de Burn-in da rota, sem campo vazio. */
export function temposDaRota(rota: string[], tempos: Record<string, string>, ehBurnin: (posto: string) => boolean): Record<string, string> {
  return Object.fromEntries(rota.filter((p) => ehBurnin(p) && (tempos[p] ?? '').trim() !== '').map((p) => [p, tempos[p]!.trim()]))
}

/** A mensagem do servidor (editarOrdemAction) para tempo de Burn-in que não é hhh:mm. */
export const erroTempoBurnin = (posto: string) => `Tempo mínimo de Burn-in inválido no posto ${posto} (use hhh:mm).`
