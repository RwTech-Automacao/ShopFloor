'use client'

import { useState } from 'react'
import { DashboardGeral } from './dashboard-geral'
import { DashboardForm } from './dashboard-form'
import type { OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'

/**
 * Duas visões no mesmo lugar:
 *  • GERAL — várias OPs, com filtros e paginação (substitui o relatório do Looker Studio).
 *  • POR OP — a tela que já existia, o progresso de uma OP posto a posto.
 *
 * Abre na Geral: é a pergunta do dia a dia ("como está a produção?"). A Por OP continua sendo o
 * caminho pra quem já sabe qual OP quer olhar, e é a que o modo apresentação do Fluxo usa.
 */
export function DashboardAbas({ ordens, postos }: { ordens: OrdemPesquisa[]; postos: string[] }) {
  const [aba, setAba] = useState<'geral' | 'op'>('geral')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-border">
        <Aba ativa={aba === 'geral'} onClick={() => setAba('geral')}>Geral</Aba>
        <Aba ativa={aba === 'op'} onClick={() => setAba('op')}>Por OP</Aba>
      </div>
      {aba === 'geral' ? <DashboardGeral ordens={ordens} postos={postos} /> : <DashboardForm ordens={ordens} />}
    </div>
  )
}

function Aba({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativa ? 'page' : undefined}
      // -mb-px cola a borda da aba ativa na borda do contêiner: sem isso fica uma linha dupla.
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        ativa ? 'border-enterplak text-enterplak' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
