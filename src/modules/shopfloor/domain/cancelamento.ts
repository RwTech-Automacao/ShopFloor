/** Postos com efeito colateral em OUTRA tabela — não são canceláveis na v1. */
const RECURSOS_BLOQUEADOS: readonly string[] = ['caixa', 'nqa', 'integracao']

/** O posto (pelo recurso do seu perfil) pode ter um bipe cancelado? Nulo/desconhecido = pode. */
export function postoCancelavel(recurso: string | null | undefined): boolean {
  return !RECURSOS_BLOQUEADOS.includes((recurso ?? '').trim())
}
