/**
 * EDIÇÃO DE OP COM TRECHOS (0184). Regras puras da página /shopfloor/ordens-nova/[id].
 *
 * A gravação é a de sempre (editarOrdemAction → atualizarOrdem): a rota vai como uma lista só e a
 * sf_ordem_regravar_postos devolve CADA POSTO AO TRECHO QUE ELE TINHA no banco; posto que não estava na OP entra no
 * trecho da PMO. As faixas regravadas são só as da PMO (as próprias das PRTs ficam como estão) e o sn_modo não muda.
 * Por isso a tela não move posto entre trechos, não edita a faixa nem a série das PRTs, e só oferece em cada trecho
 * os postos que o banco gravaria nele.
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

/** Posto → seq do trecho em que ele está GRAVADO (a base da sf_ordem_regravar_postos). */
export function trechoGravadoDosPostos(trechos: TrechoCadastro[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const t of trechos) for (const p of t.postos) m[p] = t.seq
  return m
}

/**
 * Os postos que podem entrar no trecho `seq`: fora da rota atual e que o banco gravaria NESTE trecho — o que já era
 * dele (tirado e trazido de volta) ou, no trecho da PMO, posto que não estava na OP. O Almoxarifado nunca entra numa
 * PRT (ele fecha a rota no trecho da PMO).
 */
export function postosParaAdicionar(
  catalogo: string[],
  trechos: TrechoCadastro[],
  gravado: Record<string, number>,
  seq: number,
  almoxarifado: string | null,
): string[] {
  const pmoSeq = trechos.find((t) => t.tipo === 'pmo')?.seq
  const ehPrt = trechos.find((t) => t.seq === seq)?.tipo === 'prt'
  const usados = new Set(trechos.flatMap((t) => t.postos))
  return catalogo.filter((p) => !usados.has(p) && (gravado[p] ?? pmoSeq) === seq && !(ehPrt && p === almoxarifado))
}

/** A rota inteira na ordem dos trechos: é o `fluxo` que a edição grava. */
export function rotaDosTrechos(trechos: TrechoCadastro[]): string[] {
  return trechos.flatMap((t) => t.postos)
}

/** As faixas da PMO (o `faixas` que a edição grava): as do trecho da PMO. */
export function faixasDaPmo(trechos: TrechoCadastro[]): FaixaSN[] {
  return trechos.find((t) => t.tipo === 'pmo')?.faixas ?? []
}
