/**
 * Amostra do NQA em PLACAS (placas por painel). A amostra exigida pela Tabela NQA é calculada sobre o
 * total de placas da caixa/lote, mas o inspetor bipa PAINÉIS (um SN cada). Para comparar as duas
 * coisas, cada painel amostrado vale as placas dele (`pecas` do SN). Mesma regra das RPCs
 * sf_nqa_caixa/sf_nqa_individual (0166). Com N = 1 é o número de amostras, como antes.
 */

/** Placas de cada SN, valendo a 1ª linha da lista (quem chama ordena da mais recente para a mais antiga). */
export function pecasPorSnMaisRecente(
  linhas: readonly { numero_serie_norm: string; pecas?: number | null }[],
): Record<string, number> {
  const mapa: Record<string, number> = {}
  for (const l of linhas) {
    if (Object.prototype.hasOwnProperty.call(mapa, l.numero_serie_norm)) continue
    mapa[l.numero_serie_norm] = l.pecas ?? 1
  }
  return mapa
}

/**
 * Placas cobertas pelas amostras. SN sem peso conhecido vale 1 (o progresso salvo no navegador antes
 * desta mudança não traz o mapa; e é o mesmo "vale 1" da RPC).
 */
export function placasDasAmostras(
  amostras: readonly { snNorm: string }[],
  pecasPorSn: Readonly<Record<string, number>> | undefined,
): number {
  let soma = 0
  for (const a of amostras) {
    const p = pecasPorSn && Object.prototype.hasOwnProperty.call(pecasPorSn, a.snNorm) ? pecasPorSn[a.snNorm] : undefined
    soma += typeof p === 'number' ? p : 1
  }
  return soma
}
