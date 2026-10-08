/**
 * Rotas do processo de recebimento — fonte única.
 *
 * Usadas pelos `revalidatePath` da camada de aplicação. Se a rota mudar e
 * algum lugar mantiver a string antiga, o Next não dá erro: a tela só fica
 * com dados velhos. Por isso ninguém repete o literal.
 *
 * Código puro: sem 'use server' e sem importar nada de servidor.
 */

/** Rota da lista de processos. */
export const ROTA_LISTA_PROCESSOS = '/recebimento/processos'

/** Rota do detalhe de um processo. */
export function caminhoProcesso(id: string): string {
  return `${ROTA_LISTA_PROCESSOS}/${id}`
}
