'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, ClipboardCheck, Inbox, PackageCheck, Ban } from 'lucide-react'
import { ROTULO_ETAPA, formatarEspera, type Etapa } from '@/modules/recebimento/domain/etapa-processo'

/**
 * Card de uma caixa do fluxo do Recebimento, no canvas do React Flow.
 *
 * Segue a MESMA anatomia do card do Fluxo do ShopFloor (`shopfloor/fluxo/fluxo-node.tsx`): mini-card
 * com a contagem grudado na borda esquerda, cabeçalho branco com o nome + o que a etapa é e o ícone
 * à direita, e uma subdivisão cinza embaixo com os números. O card é PRÓPRIO porque o do ShopFloor
 * carrega dados que aqui não existem (WIP, devem passar, aprovados de primeira, barra de %).
 */
export interface FluxoRecebimentoNodeData {
  etapa: Etapa
  /** O que a etapa é, em uma linha (o subtítulo "teste/inspeção · passagem" do card do ShopFloor). */
  subtitulo: string
  /** Quantos itens estão na caixa agora. */
  itens: number
  /** Quantos deles carregam a marca de divergência. */
  divergentes: number
  /** Média de há quanto tempo os itens da caixa estão nela, em segundos. */
  mediaSegundos: number | null
  /** O item mais antigo da caixa (candidato a gargalo), em segundos. */
  maiorSegundos: number | null
  /** Itens sem histórico suficiente pra saber desde quando (a tela mostra "—" neles). */
  semTempo: number
  selecionado: boolean
}

function icone(etapa: Etapa) {
  switch (etapa) {
    case 'recebimento': return <Inbox className="size-5" />
    case 'qualidade': return <ClipboardCheck className="size-5" />
    case 'almoxarifado': return <PackageCheck className="size-5" />
    case 'reprovado': return <Ban className="size-5" />
  }
}

function FluxoRecebimentoNodeBase({ data }: NodeProps) {
  const d = data as unknown as FluxoRecebimentoNodeData
  // Almoxarifado (fim do caminho bom) e Reprovado (ramo) ganham a borda vinho, como o Concluído e a
  // Manutenção do Fluxo do ShopFloor. As outras ficam com a borda cinza.
  const destaque = d.etapa === 'almoxarifado' || d.etapa === 'reprovado'
  const bordaTopo = destaque ? 'border-enterplak' : 'border-border'

  return (
    <div className="relative w-[220px]">
      {/* Os quatro handles existem em todo nó (invisíveis por CSS, `.fluxo-canvas`): a aresta escolhe
          o lado que usa — laterais na cadeia, topo/base no ramo do Reprovado. */}
      <Handle type="target" position={Position.Left} id="esq" />
      <Handle type="target" position={Position.Top} id="topo" />

      {/* Mini-card da contagem — centrado no cabeçalho (top 28px = metade do h-14), como o WIP. */}
      <div
        title={`Itens nesta etapa agora: ${d.itens}`}
        className={`absolute left-0 top-7 z-10 flex h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 cursor-help items-center justify-center rounded-[10px] border-2 px-1.5 text-sm font-bold shadow-sm ${
          d.itens > 0 ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-muted text-muted-foreground'
        }`}
      >
        {d.itens}
      </div>

      {/* overflow-hidden + anel dão o clip dos cantos e o realce de seleção do card inteiro. */}
      <div className={`overflow-hidden rounded-xl shadow-sm ${d.selecionado ? 'ring-2 ring-enterplak/40' : ''}`}>
        <div className={`flex h-14 items-center gap-2 rounded-t-xl border-2 bg-card pl-6 pr-3 transition-colors ${bordaTopo}`}>
          <div className="min-w-0 flex-1 text-left">
            <p className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
              {ROTULO_ETAPA[d.etapa]}
            </p>
            <p className="text-xs text-muted-foreground">{d.subtitulo}</p>
          </div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-enterplak/10 text-enterplak">
            {icone(d.etapa)}
          </div>
        </div>

        {/* Subdivisão: o tempo da etapa — é o que responde "essa EMB está travada em quê". */}
        <div className="flex flex-col gap-1 rounded-b-xl border-x-2 border-b-2 border-border bg-muted px-2.5 py-2 text-[11px] leading-none">
          <div className="flex items-center justify-between gap-2" title="Média de há quanto tempo os itens desta caixa estão nela">
            <span className="text-muted-foreground">Tempo médio</span>
            <span className="font-semibold tabular-nums text-foreground">{formatarEspera(d.mediaSegundos)}</span>
          </div>
          <div className="flex items-center justify-between gap-2" title="O item mais antigo desta caixa">
            <span className="text-muted-foreground">Mais antigo</span>
            <span className="font-semibold tabular-nums text-foreground">{formatarEspera(d.maiorSegundos)}</span>
          </div>
          {d.divergentes > 0 && (
            <span
              className="inline-flex cursor-help items-center gap-1 font-semibold text-amber-600"
              title={`Itens com divergência de quantidade nesta etapa: ${d.divergentes}`}
            >
              <AlertTriangle className="size-3.5" />
              {d.divergentes} com divergência
            </span>
          )}
          {d.semTempo > 0 && (
            <span
              className="cursor-help text-muted-foreground"
              title="Itens sem histórico: aparecem na caixa do status, sem tempo"
            >
              {d.semTempo} sem tempo
            </span>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="dir" />
      <Handle type="source" position={Position.Bottom} id="baixo" />
    </div>
  )
}

export const FluxoRecebimentoNode = memo(FluxoRecebimentoNodeBase)
