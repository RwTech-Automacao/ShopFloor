/**
 * Os dois estoques de destino do apontamento no Compels, escolhidos por quem confirma no Almoxarifado.
 * PA = "PA – PRODUTO ACABADO" (o de sempre); EINTER = "EINTER – ESTOQUE INTERMEDIARIO".
 * Puro: serve ao servidor e à tela. O que cada um é no ERP (ids) mora em `infra/config.ts`.
 */
export type EstoqueDestino = 'PA' | 'EINTER'

export const ESTOQUES_DESTINO: readonly EstoqueDestino[] = ['PA', 'EINTER']

export const ESTOQUE_PADRAO: EstoqueDestino = 'PA'

export function ehEstoqueDestino(valor: unknown): valor is EstoqueDestino {
  return valor === 'PA' || valor === 'EINTER'
}

/** Como a tela chama cada um: sigla e nome completo, como no ERP (pedido de 06/11/2026). */
export const ROTULO_ESTOQUE: Record<EstoqueDestino, string> = {
  PA: 'PA – Produto acabado',
  EINTER: 'EINTER – Estoque intermediário',
}
