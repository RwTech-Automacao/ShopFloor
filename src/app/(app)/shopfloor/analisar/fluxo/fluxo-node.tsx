'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Wrench } from 'lucide-react'
import type { FluxoNodeData } from '@/modules/shopfloor/domain/fluxo-op'
import type { SnDoPosto } from '@/modules/shopfloor/infra/fluxo-repository'

export interface FluxoNodePayload extends FluxoNodeData {
  aberto: boolean
  carregandoSns: boolean
  sns: SnDoPosto[]
  onAbrir: (posto: string) => void
}

function FluxoNodeBase({ data }: NodeProps) {
  const d = data as unknown as FluxoNodePayload
  return (
    <div className={`min-w-44 rounded-xl border bg-card shadow-sm ${d.ehManutencao ? 'border-amber-500' : 'border-border'}`}>
      {/* Todo nó pode ser destino (Manutenção é sempre target das arestas de reprova); só postos da cadeia são source. */}
      <Handle type="target" position={Position.Left} />
      <button
        type="button"
        onClick={() => d.onAbrir(d.posto)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {d.ehManutencao && <Wrench className="size-3.5 text-amber-600" />}
          {d.posto}
        </span>
        <span className={`rounded-md px-2 py-0.5 text-sm font-semibold ${d.wip > 0 ? 'bg-enterplak text-white' : 'bg-muted text-muted-foreground'}`}>
          {d.wip}
        </span>
      </button>

      {d.aberto && (
        <div className="border-t border-border px-3 py-2 text-xs">
          {d.temStatus ? (
            <div className="mb-2 flex gap-3">
              <span className="text-green-700">Aprov.: {d.aprovadas}</span>
              <span className="text-red-600">Reprov.: {d.reprovadas}</span>
              <span className="text-muted-foreground">Retestes: {d.retestes}</span>
            </div>
          ) : (
            <div className="mb-2 text-muted-foreground">Registradas: {d.registros}</div>
          )}
          <p className="mb-1 font-medium text-muted-foreground">Nº de Série ({d.sns.length})</p>
          {d.carregandoSns ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {d.sns.length === 0 && <li className="text-muted-foreground">—</li>}
              {d.sns.map((s, i) => (
                <li key={`${s.sn}-${i}`} className="flex justify-between gap-2 font-mono">
                  <span>{s.sn}</span>
                  <span className="text-muted-foreground">{s.status || '—'}{s.vezes > 1 ? ` ×${s.vezes}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!d.ehManutencao && <Handle type="source" position={Position.Right} />}
    </div>
  )
}

export const FluxoNode = memo(FluxoNodeBase)
