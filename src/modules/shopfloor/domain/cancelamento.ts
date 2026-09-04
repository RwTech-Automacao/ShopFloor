/**
 * Postos com efeito colateral em OUTRA tabela que o cancelamento não sabe desfazer.
 * 'caixa' SAIU da lista: a RPC (0098) desfaz o efeito em sf_caixas — apaga o bipe e, se a caixa
 * já estava fechada, reabre ela. 'nqa' e 'integracao' continuam bloqueados.
 */
const RECURSOS_BLOQUEADOS: readonly string[] = ['nqa', 'integracao']

/** O posto (pelo recurso do seu perfil) pode ter um bipe cancelado? Nulo/desconhecido = pode. */
export function postoCancelavel(recurso: string | null | undefined): boolean {
  return !RECURSOS_BLOQUEADOS.includes((recurso ?? '').trim())
}
