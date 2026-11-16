'use client'

import { createContext, useContext, type ReactNode } from 'react'
import {
  carregarFluxo, fluxoPeriodo, rotaSn, detalhePosto, historicoPosto, producaoPeriodo, burninDetalhe,
  embalagemCaixas, snsManutencao, opsComBipes,
} from '@/modules/shopfloor/application/fluxo-actions'
import { buscarHistoricoSN, carregarDefeitosDaOp, carregarResumoDefeitos } from '@/modules/shopfloor/application/pesquisa-actions'
import { carregarDashboard } from '@/modules/shopfloor/application/dashboard-actions'
import { lerEstoqueCompelsAction, lerPendenteCompelsAction } from '@/modules/shopfloor/application/estoque-compels-actions'

/**
 * De ONDE o Fluxo da OP busca os dados. A tela (e os componentes dentro dela) chamam `useFonteFluxo()`
 * em vez de importar as Server Actions direto. Sem provider, a fonte é a REAL (as actions de sempre) —
 * o Fluxo de produção não muda nada. A Vitrine do marketing troca a fonte por uma que calcula tudo no
 * navegador (sem banco, sem Compels).
 *
 * As assinaturas são as das próprias actions (`typeof`), então qualquer mudança numa action obriga a
 * fonte da vitrine a acompanhar — o compilador avisa.
 */
export interface FonteFluxo {
  carregarFluxo: typeof carregarFluxo
  fluxoPeriodo: typeof fluxoPeriodo
  rotaSn: typeof rotaSn
  detalhePosto: typeof detalhePosto
  historicoPosto: typeof historicoPosto
  producaoPeriodo: typeof producaoPeriodo
  burninDetalhe: typeof burninDetalhe
  embalagemCaixas: typeof embalagemCaixas
  snsManutencao: typeof snsManutencao
  opsComBipes: typeof opsComBipes
  buscarHistoricoSN: typeof buscarHistoricoSN
  carregarDefeitosDaOp: typeof carregarDefeitosDaOp
  carregarResumoDefeitos: typeof carregarResumoDefeitos
  carregarDashboard: typeof carregarDashboard
  lerEstoqueCompels: typeof lerEstoqueCompelsAction
  lerPendenteCompels: typeof lerPendenteCompelsAction
}

export const fonteReal: FonteFluxo = {
  carregarFluxo, fluxoPeriodo, rotaSn, detalhePosto, historicoPosto, producaoPeriodo, burninDetalhe,
  embalagemCaixas, snsManutencao, opsComBipes, buscarHistoricoSN, carregarDefeitosDaOp, carregarResumoDefeitos,
  carregarDashboard, lerEstoqueCompels: lerEstoqueCompelsAction, lerPendenteCompels: lerPendenteCompelsAction,
}

const Contexto = createContext<FonteFluxo>(fonteReal)

export function FonteFluxoProvider({ fonte, children }: { fonte: FonteFluxo; children: ReactNode }) {
  return <Contexto.Provider value={fonte}>{children}</Contexto.Provider>
}

export function useFonteFluxo(): FonteFluxo {
  return useContext(Contexto)
}
