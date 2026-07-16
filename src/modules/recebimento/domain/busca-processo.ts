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

export interface FiltrosLista {
  busca?: string
  status?: string
}

/**
 * Sufixo de query string ('?busca=…&status=…') a partir dos filtros da lista de
 * Processos; '' quando não há filtro. Usado nos links da lista e nas setas de
 * navegação para preservar o contexto/ordem.
 */
export function queryProcessos(filtros: FiltrosLista): string {
  const params = new URLSearchParams()
  if (filtros.busca) params.set('busca', filtros.busca)
  if (filtros.status) params.set('status', filtros.status)
  const s = params.toString()
  return s ? `?${s}` : ''
}
