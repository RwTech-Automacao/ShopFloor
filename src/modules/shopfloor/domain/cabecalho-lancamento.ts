import { serieDentroDaFaixa, limparSerie } from './serie'
import { ehOpFinalizada } from './ops-ativas'
import { separarCodigoCaixa } from './caixa'

/**
 * O que a busca do cabeçalho devolve. `OP_FINALIZADA` carrega a OP porque a tela precisa dizer
 * QUAL OP reativar — sem PMO/OP a mensagem não serve de nada para o operador.
 */
export type ResolucaoOpPorSn<T> =
  | { ok: true; ordem: T }
  | { ok: false; erro: 'SEM_OP' | 'AMBIGUO' }
  | { ok: false; erro: 'OP_FINALIZADA'; ordem: T }

/**
 * Resolve a OP de um SN bipado pela faixa de nº de série, em DUAS ETAPAS (adendo de 09/10/2026 da
 * spec `2026-10-08-finalizar-op-automatico-design.md`).
 *
 * 1. só entre as OPs ATIVAS — exatamente o que valia antes. Achou uma → carrega, fim.
 * 2. não achou nenhuma ativa → procura entre as FINALIZADAS. Achou → `OP_FINALIZADA`: a tela
 *    bloqueia e manda reativar a OP no cadastro, em vez do antigo "SN não encontrado".
 *
 * Duas propriedades vêm de graça desse desenho, e são o motivo dele:
 * - o SN que cai numa FINALIZADA **e** numa ATIVA carrega a ATIVA, **sem** ambiguidade nova: a
 *   etapa 1 acha a ativa e para ali, a finalizada nunca entra na conta;
 * - não custa nada no caminho normal — a segunda varredura só roda quando a primeira falha.
 *
 * Só considera OPs com faixa cadastrada (sn_ini/sn_fim não-vazios). Mais de uma OP na MESMA etapa
 * → AMBIGUO (duas ativas é o que já acontecia; duas finalizadas é raro e não dá para dizer qual
 * reativar). Nenhuma OP em etapa nenhuma → SEM_OP, como antes.
 */
export function resolverOpPorSn<T extends { sn_ini: string; sn_fim: string; status: string | null }>(
  ordens: T[],
  sn: string,
): ResolucaoOpPorSn<T> {
  const alvo = limparSerie(sn)
  if (alvo === '') return { ok: false, erro: 'SEM_OP' }
  const naFaixa = (o: T) =>
    o.sn_ini.trim() !== '' && o.sn_fim.trim() !== '' && serieDentroDaFaixa(o.sn_ini, o.sn_fim, alvo)

  // Etapa 1: as ATIVAS. `ehOpFinalizada` é case-insensitive de propósito (o status é texto livre e
  // já veio gravado em mais de uma grafia na história da planilha).
  const ativas = ordens.filter((o) => !ehOpFinalizada(o.status) && naFaixa(o))
  if (ativas.length === 1) return { ok: true, ordem: ativas[0]! }
  if (ativas.length > 1) return { ok: false, erro: 'AMBIGUO' }

  // Etapa 2: as FINALIZADAS.
  const finalizadas = ordens.filter((o) => ehOpFinalizada(o.status) && naFaixa(o))
  if (finalizadas.length === 1) return { ok: false, erro: 'OP_FINALIZADA', ordem: finalizadas[0]! }
  if (finalizadas.length > 1) return { ok: false, erro: 'AMBIGUO' }

  return { ok: false, erro: 'SEM_OP' }
}

/** O que a busca do cabeçalho por CÓDIGO DE CAIXA devolve (mesma ideia da busca por SN). */
export type ResolucaoOpPorCaixa<T> =
  | { ok: true; ordem: T }
  | { ok: false; erro: 'CAIXA_INVALIDA' | 'SEM_OP' }
  | { ok: false; erro: 'OP_FINALIZADA'; ordem: T }

/**
 * Resolve a OP pelo CÓDIGO DA CAIXA bipado (`CX[seq][qtd]OP-PMO`). Em OP coletiva o operador do Almoxarifado só
 * tem a caixa na mão, sem nenhum Nº de Série para bipar, e o código já diz de qual OP e PMO ela é.
 *
 * Só aceita código de caixa FECHADA (com quantidade): `CX[3]` sozinho é caixa aberta e devolve CAIXA_INVALIDA.
 * A OP é achada por (OP, PMO) exatos, sem diferenciar maiúsculas; entre as ATIVAS primeiro e, se não houver,
 * entre as FINALIZADAS (mesma regra de duas etapas da busca por SN).
 */
export function resolverOpPorCaixa<T extends { pmo: string; op: string; status: string | null }>(
  ordens: T[],
  codigo: string,
): ResolucaoOpPorCaixa<T> {
  const separada = separarCodigoCaixa(codigo)
  if (!separada) return { ok: false, erro: 'CAIXA_INVALIDA' }
  const igual = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
  const dela = ordens.filter((o) => igual(o.op, separada.op) && igual(o.pmo, separada.pmo))

  const ativa = dela.find((o) => !ehOpFinalizada(o.status))
  if (ativa) return { ok: true, ordem: ativa }
  const finalizada = dela.find((o) => ehOpFinalizada(o.status))
  if (finalizada) return { ok: false, erro: 'OP_FINALIZADA', ordem: finalizada }
  return { ok: false, erro: 'SEM_OP' }
}

