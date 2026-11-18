import type { Metadata } from 'next'
import { ROTA_MANIFESTO_BAIXA_NF } from '@/modules/faturamento/domain/app-baixa-nf'

/** Só as telas do Faturamento linkam o manifesto: só elas viram app instalável. */
export const metadata: Metadata = {
  manifest: ROTA_MANIFESTO_BAIXA_NF,
}

export default function FaturamentoLayout({ children }: { children: React.ReactNode }) {
  return children
}
