export interface DadosLancamento {
  colaborador?: string
  posto?: string
  pmo?: string
  op?: string
  numeroSerie?: string
  status?: string
  numeroCaixa?: string
  limiteCaixa?: string
  nqaVisual?: string
  nqaFuncional?: string
  cod?: string
  pos?: string
  tipo?: string
}

export type ResultadoRegra = { ok: true } | { ok: false; erro: string }

/** A caixa está cheia? (count = peças já na caixa; limite null = sem limite). */
export function caixaCheia(count: number, limite: number | null): boolean {
  if (limite === null || Number.isNaN(limite)) return false
  return count >= limite
}
