import type { PerfilPosto } from './perfil-posto'

/**
 * Postos que o seletor do Lançamento oferece para a OP escolhida.
 *
 * O Almoxarifado (perfil de recurso `almoxarifado`) tem tela PRÓPRIA no módulo Recebimento
 * (`/recebimento/almoxarifado`, decidido em 19/10/2026), então SAI do Lançamento comum: continua na rota
 * da OP e no card do Fluxo, mas ninguém o escolhe aqui. Na tela do Almoxarifado o formulário roda em
 * "modo Almoxarifado" e o único posto é o fixo.
 */
export function postosSelecionaveis(
  postosDaOp: readonly string[],
  perfilDo: (posto: string) => PerfilPosto,
  modoAlmoxarifado?: { posto: string } | null,
): string[] {
  if (modoAlmoxarifado) return postosDaOp.filter((p) => p === modoAlmoxarifado.posto)
  return postosDaOp.filter((p) => perfilDo(p).recurso !== 'almoxarifado')
}
