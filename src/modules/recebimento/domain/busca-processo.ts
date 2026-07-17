/**
 * Remove do termo de busca os caracteres que têm significado especial na
 * sintaxe do `.or()`/`ilike` do PostgREST antes de interpolá-lo na string do
 * filtro: `,` separa condições, `.` separa coluna/operador/valor, `(` e `)`
 * delimitam grupos, e `%` é o curinga do `ilike` (não queremos que o usuário
 * injete curingas próprios). Espaços nas extremidades também são removidos;
 * espaços internos e acentos são preservados, pois são comuns em nomes de
 * fornecedor e descrição de material.
 */
export function sanitizarTermoBusca(termo: string): string {
  return termo.replace(/[,.()*%]/g, '').trim()
}

