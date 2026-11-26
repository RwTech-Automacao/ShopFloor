'use client'

import type { Etapa, TipoOrdem } from '@/modules/sat/domain/ordem'
import type { DefeitoDaOrdem, DefeitoSat, PecaDaOrdem } from '@/modules/sat/infra/ordens-repository'

export interface ManutencaoProps {
  ordemId: string
  etapa: Etapa
  tipo: TipoOrdem | null
  podeManutencao: boolean
  defeitos: DefeitoDaOrdem[]
  pecas: PecaDaOrdem[]
  laudo: string
  defeitosAtivos: DefeitoSat[]
}

/** A manutenção da OS (corpo completo na Tarefa 14). */
export function Manutencao(_: ManutencaoProps) {
  return null
}
