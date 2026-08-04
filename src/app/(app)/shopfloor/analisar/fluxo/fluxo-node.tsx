'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Wrench, Package, GitMerge, Flame, ShieldCheck, ClipboardCheck, CircleDot, Check,
} from 'lucide-react'
import type { FluxoNodeData } from '@/modules/shopfloor/domain/fluxo-op'

export interface FluxoNodePayload extends FluxoNodeData {
  selecionado: boolean
}

/** Ícone por tipo de posto (recurso do perfil; teste/inspeção caem no ClipboardCheck via temStatus). */
function iconeDo(d: FluxoNodePayload) {
  const cls = 'size-5'
  switch (d.recurso) {
    case 'manutencao': return <Wrench className={cls} />
    case 'caixa': return <Package className={cls} />
    case 'integracao': return <GitMerge className={cls} />
    case 'burnin': return <Flame className={cls} />
    case 'nqa': return <ShieldCheck className={cls} />
    default: return d.temStatus ? <ClipboardCheck className={cls} /> : <CircleDot className={cls} />
  }
}

function FluxoNodeBase({ data }: NodeProps) {
  const d = data as unknown as FluxoNodePayload
  const borda = d.selecionado
    ? 'border-enterplak ring-2 ring-enterplak/50'
    : d.concluido
      ? 'border-enterplak'
      : d.ehManutencao
        ? 'border-amber-500/70'
        : 'border-neutral-700'

  return (
    <div className={`w-[200px] rounded-xl border-2 bg-neutral-900 shadow-lg transition-colors ${borda}`}>
      <Handle type="target" position={Position.Left} className="!border-neutral-600 !bg-neutral-400" />

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${d.ehManutencao ? 'bg-amber-500/15 text-amber-400' : 'bg-enterplak/15 text-enterplak'}`}>
          {iconeDo(d)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-100">{d.posto}</p>
          <p className="text-xs text-neutral-400">
            {d.ehManutencao ? 'em manutenção' : d.concluido ? 'concluído' : d.temStatus ? 'teste/inspeção' : 'passagem'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={`rounded-md px-2 py-0.5 text-sm font-bold ${d.wip > 0 ? 'bg-enterplak text-white' : 'bg-neutral-800 text-neutral-500'}`}>
            {d.wip}
          </span>
          {d.concluido && <Check className="mt-0.5 size-3.5 text-enterplak" />}
        </div>
      </div>

      {!d.ehManutencao && <Handle type="source" position={Position.Right} className="!border-neutral-600 !bg-neutral-400" />}
    </div>
  )
}

export const FluxoNode = memo(FluxoNodeBase)
