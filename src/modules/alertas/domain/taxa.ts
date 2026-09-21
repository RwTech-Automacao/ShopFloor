/**
 * Taxa de aprovação EXATA (sem formatação). Só bipes aprovados/reprovados entram na conta — a
 * régua é a mesma do Dashboard (0101). Sem nenhum dos dois, não há taxa (null), e a regra não
 * decide nada.
 */
export function taxaAprovacao(aprovados: number, reprovados: number): number | null {
  const total = aprovados + reprovados
  if (total <= 0) return null
  return (aprovados * 100) / total
}

/**
 * Taxa com 1 casa decimal TRUNCADA (mesma régua do Dashboard: 88,88% mostra 88,8, não 88,9).
 * A conta é feita em décimos INTEIROS (`aprovados * 1000 / total`) para não depender do
 * arredondamento binário de `toFixed`.
 */
export function formatarTaxa(aprovados: number, reprovados: number): string {
  const total = aprovados + reprovados
  if (total <= 0) return '—'
  const decimos = Math.floor((aprovados * 1000) / total)
  return (decimos / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** Meta da regra (`taxa_minima`) como o gestor digitou: '90', '92,5', '99,95'. */
export function formatarMeta(taxaMinima: number): string {
  return taxaMinima.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

/**
 * Taxa JÁ CALCULADA (o banco grava com 2 casas: 88,88) mostrada com 1 casa TRUNCADA (88,8) — a
 * mesma régua de `formatarTaxa`. Arredonda para centésimos inteiros antes de truncar, para não
 * depender do arredondamento binário (0,29 × 100 = 28,999...).
 */
export function formatarTaxaValor(taxa: number): string {
  const decimos = Math.floor(Math.round(taxa * 100) / 10)
  return (decimos / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
