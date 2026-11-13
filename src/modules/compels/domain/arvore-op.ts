/**
 * Uma OP do Compels como nó da árvore mãe→filhas (estudo de 11/11/2026): a LISTA de OPs (`findAllFilter`) traz
 * `nivel`, `ordemProducaoMaeNumero` e `ordemProducaoPrincipalNumero`; o código do produto só vem no DETALHE
 * (`findById` → composicaoProduto.item). Nó sem código = resposta inesperada → null (nunca inventa).
 */
export interface NoOp {
  numero: number
  codigo: string
  descricao: string
  nivel: number
  mae: number | null
  principal: number | null
  status: string
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function noDaLinhaOp(linha: unknown, detalhe: unknown): NoOp | null {
  const l = (linha ?? {}) as Record<string, unknown>
  const d = ((detalhe as { data?: unknown } | null)?.data ?? detalhe ?? {}) as Record<string, unknown>
  const item = (d.composicaoProduto as { item?: Record<string, unknown> } | undefined)?.item
  const numero = num(l.numero)
  if (numero === null || typeof item?.codigo !== 'string' || item.codigo.trim() === '') return null
  return {
    numero,
    codigo: item.codigo.trim(),
    descricao: typeof item.descricao === 'string' ? item.descricao.trim() : '',
    nivel: num(l.nivel) ?? 1,
    mae: num(l.ordemProducaoMaeNumero),
    principal: num(l.ordemProducaoPrincipalNumero),
    status: typeof l.status === 'string' ? l.status : '',
  }
}
