'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Wrench, Package, GitMerge, Flame, ShieldCheck, ClipboardCheck, CircleDot, Check, Inbox, PackageCheck, AlertTriangle,
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

  // Card do posto: UM card com SUBDIVISÃO interna (cabeçalho em cima + barra/métricas embaixo, separados
  // por border-t): contagem/barra por APROVADAS (reprovados fora); nome à esquerda (alinhado ao mini-card);
  // "aprovados de primeira" vira % (aprovadosPrimeira ÷ o-que-passou) com CHECK; reprovados = número com
  // "!"; sem anel ao concluir. Tooltips (title) explicam o significado E a conta.
  const pctB = d.devemPassar && d.devemPassar > 0 ? Math.min(100, Math.round((d.aprovadas / d.devemPassar) * 100)) : 0
  const basePassou = d.aprovadas + d.reprovadosSemReteste // o-que-passou (aprovadas + reprovadas pendentes)
  const fpPct = basePassou > 0 ? Math.round((d.aprovadosPrimeira / basePassou) * 100) : 0
  const tipAprov = `Aprovadas ÷ devem passar: ${d.aprovadas} de ${d.devemPassar ?? '—'} (reprovadas não entram na conta)`
  const tipFp = `Aprovados de primeira: ${d.aprovadosPrimeira} de ${basePassou} que passaram = ${fpPct}%`
  const tipRep = `Reprovados sem reteste: ${d.reprovadosSemReteste} peça(s) com o último registro reprovado`
  const temSub = !d.ehManutencao && d.devemPassar != null
  // Concluído/Manutenção realçam SÓ o cabeçalho (parte branca): a borda vinho fica no topo e
  // a subdivisão de baixo mantém a borda cinza. Selecionado realça o card inteiro (anel).
  const bordaTopo = d.concluido || d.ehManutencao ? 'border-enterplak' : 'border-border'
  return (
    <div className="relative w-[220px]">
      <Handle type="target" position={Position.Left} />

      {/* WIP mini-card — centrado no CABEÇALHO (top 28px = metade do h-14). */}
      <div
        className={`pointer-events-none absolute left-0 top-7 z-10 flex h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[10px] border-2 px-1.5 text-sm font-bold shadow-sm ${
          d.wip > 0 ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-muted text-muted-foreground'
        }`}
      >
        {d.wip}
      </div>

      {/* overflow-hidden + anel dão o clip dos cantos e o realce de seleção do card inteiro. */}
      <div className={`overflow-hidden rounded-xl shadow-sm ${d.selecionado ? 'ring-2 ring-enterplak/40' : ''}`}>
        {/* Cabeçalho (parte branca): borda de destaque (vinho quando concluído) no topo, laterais E na
            base — essa base vira a linha divisória, então o vinho também "cruza o meio". */}
        <div className={`flex h-14 items-center gap-2 border-2 bg-card pl-6 pr-3 transition-colors ${bordaTopo} ${temSub ? 'rounded-t-xl' : 'rounded-xl'}`}>
          <div className="min-w-0 flex-1 text-left">
            <p className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">{d.posto}</p>
            <p className="text-xs text-muted-foreground">
              {d.ehManutencao ? 'em manutenção' : d.temStatus ? 'teste/inspeção' : 'passagem'}
            </p>
          </div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-enterplak/10 text-enterplak">
            {iconeDo(d)}
          </div>
        </div>

        {/* Subdivisão — laterais e base SEMPRE cinza; o topo é a borda de baixo do cabeçalho (a divisória vinho). */}
        {temSub && (
          <div className="flex flex-col gap-1.5 rounded-b-xl border-x-2 border-b-2 border-border bg-muted px-2.5 py-2">
            <div className="relative h-5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10" title={tipAprov}>
              <div className="absolute inset-y-0 left-0 rounded-full bg-green-600" style={{ width: `${pctB}%` }} />
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold leading-none tabular-nums text-white">{pctB}%</span>
            </div>
            <div className="flex items-center justify-center gap-3 text-[11px] font-semibold leading-none tabular-nums">
              <span title={tipAprov}><span className="text-green-700">{d.aprovadas}</span> <span className="text-muted-foreground">/ {d.devemPassar}</span></span>
              {d.temStatus && (
                <>
                  <span className="inline-flex cursor-help items-center gap-1 text-green-700" title={tipFp}>
                    <Check className="size-3.5" />{fpPct}%
                  </span>
                  <span className="inline-flex cursor-help items-center gap-1 text-amber-600" title={tipRep}>
                    <AlertTriangle className="size-3.5" />{d.reprovadosSemReteste}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {!d.ehManutencao && <Handle type="source" position={Position.Right} />}
    </div>
  )
}

export const FluxoNode = memo(FluxoNodeBase)
