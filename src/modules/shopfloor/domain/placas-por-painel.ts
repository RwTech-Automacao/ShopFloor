/** Placas que N painéis somam (cada bipe de painel conta como `placasPorPainel` placas). */
export function placasDosPaineis(paineis: number, placasPorPainel: number): number {
  return paineis * placasPorPainel
}

/** Painéis que `placas` formam; null quando não divide exato. */
export function paineisDasPlacas(placas: number, placasPorPainel: number): number | null {
  if (placasPorPainel < 1 || placas % placasPorPainel !== 0) return null
  return placas / placasPorPainel
}
