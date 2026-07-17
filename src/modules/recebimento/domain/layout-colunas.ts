/** Uma coluna do layout da lista de Processos, como fica no banco. */
export interface ColunaLayout {
  campo: string
  visivel: boolean
  ordem: number
}

/** Colunas que o admin NÃO pode ocultar (mas pode reordenar). */
export const COLUNAS_FIXAS: readonly string[] = ['numero', 'status']

/**
 * Deriva o layout completo a partir da lista ordenada de campos visíveis vinda do
 * cliente. O `catalogo` é a whitelist (carregada no servidor):
 * - campo fora do catálogo, ou repetido, é descartado;
 * - `COLUNAS_FIXAS` são forçadas visíveis (se vierem ausentes, entram no fim);
 * - visíveis recebem ordem 1..N na ordem dada; as ocultas (catálogo − visíveis) vêm
 *   depois, na ordem do catálogo.
 * Não muta as entradas.
 */
export function normalizarLayout(visiveis: string[], catalogo: string[]): ColunaLayout[] {
  const noCatalogo = new Set(catalogo)
  const escolhidas: string[] = []
  const jaVisivel = new Set<string>()

  for (const campo of visiveis) {
    if (!noCatalogo.has(campo) || jaVisivel.has(campo)) continue
    jaVisivel.add(campo)
    escolhidas.push(campo)
  }

  // A UI não deixa ocultar as fixas, mas o cliente não é confiável.
  for (const fixa of COLUNAS_FIXAS) {
    if (!noCatalogo.has(fixa) || jaVisivel.has(fixa)) continue
    jaVisivel.add(fixa)
    escolhidas.push(fixa)
  }

  const layout: ColunaLayout[] = escolhidas.map((campo, i) => ({
    campo,
    visivel: true,
    ordem: i + 1,
  }))

  let ordem = escolhidas.length
  for (const campo of catalogo) {
    if (jaVisivel.has(campo)) continue
    ordem += 1
    layout.push({ campo, visivel: false, ordem })
  }

  return layout
}
