/** Receita vazia libera qualquer PMO; senão a PMO da placa precisa estar na receita
 * (comparação case-insensitive, ignorando espaços nas pontas). */
export function receitaPermite(receita: string[], placaPmo: string): boolean {
  if (receita.length === 0) return true
  const alvo = placaPmo.trim().toLowerCase()
  return receita.some((r) => r.trim().toLowerCase() === alvo)
}
