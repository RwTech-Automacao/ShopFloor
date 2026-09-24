'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Ban, ClipboardCheck, History, Inbox, PackageCheck, Timer } from 'lucide-react'
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
  // Os itens sem tempo conhecido entram no tooltip da média em vez de virar linha nova: o card tem
  // que ter a mesma altura do card do ShopFloor. O painel do nó mostra o número explícito.
  const tipMedia = d.semTempo > 0
    ? `Média de há quanto tempo os itens desta caixa estão nela — ${d.semTempo} sem tempo conhecido (aparecem na caixa do status)`
    : 'Média de há quanto tempo os itens desta caixa estão nela'

  return (
    <div className="relative w-[220px]">
      {/* Um handle de cada tipo, como no card do ShopFloor: a aresta é FLUTUANTE (ela calcula o
          ponto na borda que aponta pro outro card), então o lado do handle não manda no traçado.
          Os pontos ficam invisíveis por CSS (`.fluxo-canvas`). */}
      <Handle type="target" position={Position.Left} />

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

        {/* Subdivisão — laterais e base sempre cinza, como no card do ShopFloor. Aqui vai o tempo da
            etapa, que é o que responde "essa EMB está travada em quê". Uma linha de métricas com
            tooltip em cada uma, no mesmo formato da linha de aprovadas/1ª/reprovadas de lá. */}
        <div className="flex items-center justify-center gap-3 rounded-b-xl border-x-2 border-b-2 border-border bg-muted px-2.5 py-2 text-[11px] font-semibold leading-none tabular-nums">
          <span className="inline-flex cursor-help items-center gap-1" title={tipMedia}>
            <Timer className="size-3.5 text-muted-foreground" />
            {formatarEspera(d.mediaSegundos)}
          </span>
          <span className="inline-flex cursor-help items-center gap-1" title="O item mais antigo desta caixa">
            <History className="size-3.5 text-muted-foreground" />
            {formatarEspera(d.maiorSegundos)}
          </span>
          {d.divergentes > 0 && (
            <span
              className="inline-flex cursor-help items-center gap-1 text-amber-600"
              title={`Itens com divergência de quantidade nesta etapa: ${d.divergentes}`}
            >
              <AlertTriangle className="size-3.5" />
              {d.divergentes}
            </span>
          )}
        </div>
      </div>

      {/* O Reprovado é fim de linha: dele não sai aresta nenhuma (como a Manutenção do ShopFloor,
          que também não tem handle de saída). */}
      {d.etapa !== 'reprovado' && <Handle type="source" position={Position.Right} />}
    </div>
  )
}

export const FluxoRecebimentoNode = memo(FluxoRecebimentoNodeBase)
