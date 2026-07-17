/** Um vizinho na lista: o id e a posição que ele ocupa (vai no link, como `?i=`). */
export interface Vizinho {
  id: string
  posicao: number
}

export interface Vizinhos {
  anterior: Vizinho | null
  proximo: Vizinho | null
}

/** Vizinho em `posicao`, ou null se a posição está fora da lista. */
function em(ids: string[], posicao: number): Vizinho | null {
  if (posicao < 0 || posicao >= ids.length) return null
  const id = ids[posicao]
  return id === undefined ? null : { id, posicao }
}

/**
 * Vizinhos de `idAtual` numa lista ordenada de ids.
 *
 * - `idAtual` PRESENTE → usa a posição real encontrada; a `posicao` informada é
 *   ignorada (auto-corrige links velhos).
 * - `idAtual` AUSENTE (ex.: saiu do filtro depois de você finalizá-lo) → usa `posicao`
 *   como o lugar que ele ocupava: a lista encolheu 1, então quem estava em `posicao + 1`
 *   agora está em `posicao` → esse é o próximo. É o fluxo de despachar uma fila.
 * - Ausente e sem `posicao` → não inventa: ambos `null`.
 *
 * Não muta as entradas.
 */
export function vizinhosDaLista(
  ids: string[],
  idAtual: string,
  posicao: number | null,
): Vizinhos {
  const atual = ids.indexOf(idAtual)
  if (atual >= 0) {
    return { anterior: em(ids, atual - 1), proximo: em(ids, atual + 1) }
  }
  if (posicao === null || posicao < 0) return { anterior: null, proximo: null }
  return { anterior: em(ids, posicao - 1), proximo: em(ids, posicao) }
}
