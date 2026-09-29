/**
 * Postos com efeito colateral em OUTRA tabela que o cancelamento não sabe desfazer.
 * 'caixa' SAIU da lista: a RPC (0106) desfaz o efeito em sf_caixas — apaga o bipe e, se a caixa
 * já estava fechada, reabre ela. 'nqa' e 'integracao' continuam bloqueados.
 */
const RECURSOS_BLOQUEADOS: readonly string[] = ['nqa', 'integracao']

/** O posto (pelo recurso do seu perfil) pode ter um bipe cancelado? Nulo/desconhecido = pode. */
export function postoCancelavel(recurso: string | null | undefined): boolean {
  return !RECURSOS_BLOQUEADOS.includes((recurso ?? '').trim())
}

/**
 * Este registro é uma ENTRADA DE CAIXA no Almoxarifado?
 *
 * Importa porque o desfazer dele é outro: a entrada foi UM bipe do código da caixa que gravou UMA
 * LINHA POR PEÇA (0129), então o que a tela oferece não é "cancelar este bipe" e sim "cancelar a
 * caixa inteira" (0131) — um motivo só, as N linhas de uma vez.
 *
 * Duas condições, e as duas são necessárias: o RECURSO do perfil do posto ('almoxarifado', nunca o
 * nome do posto) e ter código de caixa. Entrada de OP com embalagem INDIVIDUAL cai no mesmo posto mas
 * grava numero_caixa vazio — ali a entrada já é uma peça, um bipe, uma linha, e quem desfaz é o
 * cancelamento de sempre.
 */
export function ehEntradaDeCaixaAlmoxarifado(
  recurso: string | null | undefined,
  numeroCaixa: string | null | undefined,
): boolean {
  return (recurso ?? '').trim() === 'almoxarifado' && (numeroCaixa ?? '').trim() !== ''
}
