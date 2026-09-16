'use client'

import { useState } from 'react'
import { RepinmetroForm } from './repinmetro-form'
import { IntegracaoRepForm } from './integracao-rep-form'

/**
 * Duas consultas do repinmetro no mesmo lugar:
 *  • TESTES — os testes de qualidade do REP (com a revenda), a tela que já existia;
 *  • INTEGRAÇÃO — o teste de produção: quais peças foram montadas no REP, buscando pelo REP ou pela peça.
 */
export function RepinmetroAbas({ modelos }: { modelos: string[] }) {
  const [aba, setAba] = useState<'testes' | 'integracao'>('testes')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-border">
        <Aba ativa={aba === 'testes'} onClick={() => setAba('testes')}>Testes</Aba>
        <Aba ativa={aba === 'integracao'} onClick={() => setAba('integracao')}>Integração</Aba>
      </div>
      {aba === 'testes' ? <RepinmetroForm modelos={modelos} /> : <IntegracaoRepForm modelos={modelos} />}
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
