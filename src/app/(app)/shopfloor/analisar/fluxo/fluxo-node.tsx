'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Wrench, Package, GitMerge, Flame, ShieldCheck, ClipboardCheck, CircleDot, Check, Inbox, PackageCheck,
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

  // Caixas de Entrada/Saída: bloco em vinho predominante, só com a contagem (sem detalhe ao clicar).
  if (d.ehEntrada || d.ehSaida) {
    const rotulo = d.ehEntrada ? 'Entrada' : 'Saída'
    const sub = d.ehEntrada ? 'não iniciadas' : 'finalizadas'
    return (
      <div className={`w-[200px] rounded-xl border-2 border-enterplak bg-enterplak text-white shadow-sm ${d.selecionado ? 'ring-2 ring-enterplak/40' : ''}`}>
        {d.ehSaida && <Handle type="target" position={Position.Left} />}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
            {d.ehEntrada ? <Inbox className="size-5" /> : <PackageCheck className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{rotulo}</p>
            <p className="text-xs text-white/75">{sub}</p>
          </div>
          <span className="shrink-0 rounded-md bg-white/20 px-2 py-0.5 text-sm font-bold">{d.wip}</span>
        </div>
        {d.ehEntrada && <Handle type="source" position={Position.Right} />}
      </div>
    )
  }

  const borda = d.selecionado
    ? 'border-enterplak ring-2 ring-enterplak/40'
    : d.concluido || d.ehManutencao
      ? 'border-enterplak'
      : 'border-border'

  // Manutenção é ramo (não tem "devem passar"): mantém o card antigo — ícone à esquerda,
  // WIP como badge no canto direito, sem número/barra fora do card.
  if (d.ehManutencao) {
    return (
      <div className={`w-[200px] rounded-xl border-2 bg-card shadow-sm transition-colors ${borda}`}>
        <Handle type="target" position={Position.Left} />
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-enterplak/10 text-enterplak">
            {iconeDo(d)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium leading-tight text-foreground">{d.posto}</p>
            <p className="text-xs text-muted-foreground">em manutenção</p>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className={`rounded-md px-2 py-0.5 text-sm font-bold ${d.wip > 0 ? 'bg-enterplak text-white' : 'bg-muted text-muted-foreground'}`}>
              {d.wip}
            </span>
          </div>
        </div>
      </div>
    )
  }

  // Postos normais: "já passaram / devem passar" ACIMA e barra de progressão ABAIXO, ambos FORA
  // do card e absolutamente posicionados (não alteram a altura de layout do nó, senão os
  // Handle/arestas deslocariam do meio do card). Sem qtd (devemPassar null): só o número, sem "/qtd" e sem barra.
  const pct = d.devemPassar && d.devemPassar > 0 ? Math.min(100, Math.round((d.passou / d.devemPassar) * 100)) : 0

  return (
    <div className={`relative w-[200px] rounded-xl border-2 bg-card shadow-sm transition-colors ${borda}`}>
      <div className="absolute inset-x-0 -top-5 flex items-baseline justify-center gap-1 text-xs">
        <span className="font-bold text-enterplak tabular-nums">{d.passou}</span>
        {d.devemPassar != null && <span className="text-muted-foreground">/ {d.devemPassar}</span>}
      </div>

      <Handle type="target" position={Position.Left} />

      {/* WIP: mini-card (miniatura do card) ancorado na entrada, metade fora, sobre o Handle esquerdo. */}
      <div
        className={`pointer-events-none absolute left-0 top-1/2 z-10 flex h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[10px] border-2 bg-white px-1.5 text-sm font-bold shadow-sm ${
          d.wip > 0 ? 'border-enterplak text-enterplak' : 'border-border text-muted-foreground'
        }`}
      >
        {d.wip}
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-tight text-foreground">{d.posto}</p>
          <p className="text-xs text-muted-foreground">
            {d.concluido ? 'concluído' : d.temStatus ? 'teste/inspeção' : 'passagem'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-enterplak/10 text-enterplak">
            {iconeDo(d)}
          </div>
          {d.concluido && <Check className="size-3.5 text-enterplak" />}
        </div>
      </div>

      {d.devemPassar != null && (
        <div className="absolute inset-x-3 -bottom-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-enterplak" style={{ width: `${pct}%` }} />
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const FluxoNode = memo(FluxoNodeBase)
