/** Posto imediatamente anterior a `postoAtual` na sequência ordenada da OP (ou null). */
export function postoAnteriorNaSequencia(postoAtual: string, postosOrdenados: string[]): string | null {
  const idx = postosOrdenados.findIndex((p) => p.toLowerCase() === postoAtual.toLowerCase())
  if (idx <= 0) return null
  return postosOrdenados[idx - 1] ?? null
}
