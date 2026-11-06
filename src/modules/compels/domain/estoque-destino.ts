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

/** Como a tela chama cada um. */
export const ROTULO_ESTOQUE: Record<EstoqueDestino, string> = {
  PA: 'PA',
  EINTER: 'EINTER',
}
