'use client'

import type { NodeProps } from '@xyflow/react'

/** Dados do nó de moldura (o tamanho vem do `style` do nó). */
export interface MolduraTrechoPayload { rotulo: string; escolhido: boolean; apagado: boolean }

/**
 * Fundo de um trecho da OP no desenho: um retângulo discreto em volta dos postos do trecho, com o rótulo
 * ("PRT410 · OP 8500") no canto. É um nó do React Flow (segue pan/zoom) com zIndex abaixo dos cards e
 * pointer-events none: não pega clique nem arrasto.
 */
export function MolduraTrechoNode({ data }: NodeProps) {
  const d = data as unknown as MolduraTrechoPayload
  return (
    <div
      data-testid="moldura-trecho"
      aria-hidden
      className={`pointer-events-none relative h-full w-full rounded-2xl border transition-opacity ${
        d.escolhido ? 'border-enterplak/50 bg-enterplak/5' : 'border-dashed border-neutral-300 bg-white/40 dark:border-neutral-600 dark:bg-white/5'
      } ${d.apagado ? 'opacity-40' : ''}`}
    >
      <span className={`absolute left-3 top-1.5 whitespace-nowrap text-sm font-semibold ${d.escolhido ? 'text-enterplak' : 'text-neutral-500 dark:text-neutral-400'}`}>
        {d.rotulo}
      </span>
    </div>
  )
}
