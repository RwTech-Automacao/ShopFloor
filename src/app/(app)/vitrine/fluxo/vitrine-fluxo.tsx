'use client'

import { useState } from 'react'
import { FluxoForm } from '@/app/(app)/shopfloor/fluxo/fluxo-form'
import { FonteFluxoProvider } from '@/app/(app)/shopfloor/fluxo/fonte-fluxo'
import { criarFonteVitrine, relogioDoLaco, INTERVALO_VITRINE_MS } from './fonte-vitrine'
import { PMO_DEMO, OP_DEMO, CLIENTE_DEMO, DESCRICAO_DEMO, NOMES_POSTOS, QTD_DEMO, snDaPeca } from '@/modules/vitrine/domain/op-demo'

const OP = { pmo: PMO_DEMO, op: OP_DEMO, cliente: CLIENTE_DEMO, descricao: DESCRICAO_DEMO, criadoEm: '2026-10-20T07:00:00-03:00' }
const ORDEM_DASHBOARD = {
  cliente: CLIENTE_DEMO, pmo: PMO_DEMO, op: OP_DEMO, descricao: DESCRICAO_DEMO,
  sn_ini: snDaPeca(0), sn_fim: snDaPeca(QTD_DEMO - 1), placas_por_painel: 1, postos: NOMES_POSTOS,
}

/** O Fluxo da OP REAL (mesmo componente), com a fonte de dados da vitrine e as peças andando. */
export function VitrineFluxo() {
  // A fonte nasce uma vez por visita: o relógio do laço começa quando a tela abre.
  const [fonte] = useState(() => criarFonteVitrine(relogioDoLaco(Date.now())))
  return (
    <FonteFluxoProvider fonte={fonte}>
      <FluxoForm
        ops={[OP]}
        ordensDashboard={[ORDEM_DASHBOARD]}
        opFixa={{ pmo: PMO_DEMO, op: OP_DEMO }}
        ocultarSeletor
        intervaloAtualizacaoMs={INTERVALO_VITRINE_MS}
        pecasAndando
      />
    </FonteFluxoProvider>
  )
}
