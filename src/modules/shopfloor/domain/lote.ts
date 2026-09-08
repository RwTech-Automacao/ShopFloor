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

/**
 * Cor do item do lote na UI. Os emojis do `emojiItemLote` NÃO garantem cor: em aparelho sem fonte
 * de emoji colorida (caso dos tablets do chão de fábrica) o ❌ cai no glifo monocromático e sai
 * PRETO — o operador perde o vermelho que diferencia a reprova de relance. A cor por CSS vale nos
 * dois casos: pinta o glifo monocromático e é ignorada quando a fonte já é colorida.
 */
export function corItemLote(i: { estado: EstadoItemLote; outcome?: 'aprovado' | 'reprovado' | null; erro?: string }): string {
  if (i.estado === 'pendente') return 'text-muted-foreground'
  if (i.erro) return 'text-amber-600'
  if (i.outcome === 'reprovado') return 'text-red-600'
  return 'text-green-700'
}

/** Emoji do item do lote na UI: ⏳ pendente · ✔️ aprovado · ❌ reprovado · ⚠️ falhou no envio. */
export function emojiItemLote(i: { estado: EstadoItemLote; outcome?: 'aprovado' | 'reprovado' | null; erro?: string }): string {
  if (i.estado === 'pendente') return '⏳'
  if (i.erro) return '⚠️'
  if (i.outcome === 'reprovado') return '❌'
  return '✔️'
}
