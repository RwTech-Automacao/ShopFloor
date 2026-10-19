'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Explica } from './explica'

/**
 * PMOs da regra: lista de marcar com busca. Nenhuma marcada = todas as PMOs. Uma PMO salva que não
 * está mais na lista (OP apagada, por exemplo) continua aparecendo — marcada — para não sumir calada.
 */
export function PmosSelecao({
  disponiveis,
  selecionadas,
  onChange,
}: {
  disponiveis: string[]
  selecionadas: string[]
  onChange: (pmos: string[]) => void
}) {
  const [busca, setBusca] = useState('')
  const todas = [...new Set([...selecionadas, ...disponiveis])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const filtro = busca.trim().toUpperCase()
  const visiveis = filtro ? todas.filter((p) => p.toUpperCase().includes(filtro)) : todas

  function alternar(pmo: string) {
    onChange(selecionadas.includes(pmo) ? selecionadas.filter((p) => p !== pmo) : [...selecionadas, pmo])
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="flex items-center gap-1.5 text-sm font-medium">
        PMOs
        <Explica titulo="PMOs">
          <p>Limita a conta aos bipes dessas PMOs. <strong>Nenhuma marcada = todas as PMOs.</strong></p>
          <p>Na janela <strong>OP em andamento</strong>, vale a OP do último bipe do posto entre as PMOs marcadas.</p>
        </Explica>
      </legend>
      <Input aria-label="Buscar PMO" placeholder="Buscar PMO" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="flex max-h-40 flex-wrap gap-3 overflow-y-auto rounded-md border border-border p-3">
        {visiveis.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma PMO encontrada.</span>}
        {visiveis.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={`PMO ${p}`} checked={selecionadas.includes(p)} onChange={() => alternar(p)} />
            {p}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Nenhuma marcada = todas as PMOs.</p>
      {selecionadas.length > 0 && (
        <p className="text-xs text-muted-foreground">Marcadas: {selecionadas.join(', ')}</p>
      )}
    </fieldset>
  )
}
