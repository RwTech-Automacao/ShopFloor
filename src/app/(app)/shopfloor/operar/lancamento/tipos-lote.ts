import type { EntradaLancamento } from '@/modules/shopfloor/application/lancar-action'

/** Item empilhado no lote (Lançamento Coletivo): a mesma entrada que iria pro `lancar`, mais o
 * resultado (aprovado/reprovado/null) já resolvido pra exibição — a gravação em si é adiada. */
export type ItemLote =
  | { estado: 'pendente'; sn: string; snNorm: string }
  | { estado: 'resolvido'; sn: string; snNorm: string; entrada: EntradaLancamento; outcome: 'aprovado' | 'reprovado' | null; erro?: string }
