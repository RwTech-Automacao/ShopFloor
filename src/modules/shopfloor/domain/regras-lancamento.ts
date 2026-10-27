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

/** O bipe estoura a caixa? (count = placas já na caixa; pecasDoBipe = placas do painel que vai
 *  entrar, 1 por padrão; limite null = sem limite). Painel é sempre completo, não há parcial. */
export function caixaCheia(count: number, limite: number | null, pecasDoBipe = 1): boolean {
  if (limite === null || Number.isNaN(limite)) return false
  return count + pecasDoBipe > limite
}
