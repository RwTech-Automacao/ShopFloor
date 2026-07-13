/**
 * Colunas pesquisadas pela busca livre da lista de processos, via
 * `.or(...)` com `ilike` (ver `listarProcessos`).
 */
export const COLUNAS_BUSCA_PROCESSO = [
  'numero_nf',
  'numero_pedido',
  'fornecedor',
  'codigo_material',
  'descricao_material',
] as const

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

/**
 * Monta a string do filtro `.or(...)` de busca livre (ilike em várias colunas)
 * a partir do termo sanitizado, ou `null` se não houver termo. Centraliza a
 * construção usada por `listarProcessosDoMes` e `listarMesesProcessos`.
 */
export function condicaoBuscaProcesso(busca: string | undefined): string | null {
  const termo = busca ? sanitizarTermoBusca(busca) : ''
  if (!termo) return null
  return COLUNAS_BUSCA_PROCESSO.map((coluna) => `${coluna}.ilike.%${termo}%`).join(',')
}
