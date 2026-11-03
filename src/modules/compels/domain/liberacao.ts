import { semSufixo } from './sem-sufixo'

/**
 * Quais OPs a integração com o Compels pode enviar. Lista em `COMPELS_OPS_LIBERADAS`: números de OP
 * separados por vírgula, ou `*` para todas. Vazia ou ausente = NENHUMA (esquecer a variável no deploy
 * não pode ligar a integração, como na liberação dos Alertas). Compara pelo texto da OP aparado ou pelo
 * número que o Compels conhece: `8682` na lista também libera a OP `8682_F` do ShopFloor.
 */
export function opLiberada(op: string, lista: string | undefined): boolean {
  const itens = (lista ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (itens.length === 0) return false
  if (itens.includes('*')) return true
  return itens.includes(op.trim()) || itens.includes(semSufixo(op))
}
