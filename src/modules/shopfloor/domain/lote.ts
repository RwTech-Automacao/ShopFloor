/** Limite de itens por lote no Lançamento Coletivo (usado pela action e pelo form). */
export const MAX_LOTE = 15

/** Estado de um item na lista do lote coletivo. */
export type EstadoItemLote = 'pendente' | 'resolvido'

/** Índice do placeholder PENDENTE com este SN normalizado (ou -1 se não houver). */
export function acharPendente<T extends { estado: EstadoItemLote; snNorm: string }>(
  itens: readonly T[], snNorm: string,
): number {
  return itens.findIndex((i) => i.estado === 'pendente' && i.snNorm === snNorm)
}

/** Já existe um item RESOLVIDO com este SN normalizado? */
export function jaResolvido<T extends { estado: EstadoItemLote; snNorm: string }>(
  itens: readonly T[], snNorm: string,
): boolean {
  return itens.some((i) => i.estado === 'resolvido' && i.snNorm === snNorm)
}

/** Quantos itens já foram resolvidos (aprovados/reprovados). */
export function contarResolvidos<T extends { estado: EstadoItemLote }>(itens: readonly T[]): number {
  return itens.filter((i) => i.estado === 'resolvido').length
}

/** Há ao menos um placeholder pendente (não bipado ainda)? */
export function temPendentes<T extends { estado: EstadoItemLote }>(itens: readonly T[]): boolean {
  return itens.some((i) => i.estado === 'pendente')
}
