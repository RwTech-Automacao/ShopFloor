import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type EdgeProps, useInternalNode } from '@xyflow/react'
import { ancorasCurva, ancorasOrtogonal } from '@/shared/ui/fluxo/ancoras-aresta'
import { formatarRelogio } from '@/modules/shopfloor/domain/fluxo-op'

/**
 * Arestas FLUTUANTES: a linha conecta no ponto da BORDA de cada card que aponta pro outro
 * (não em handles fixos esquerda/direita). Assim o traçado fica certo em QUALQUER arranjo —
 * horizontal, em colunas, serpente, diagonal — inclusive quando o usuário arrasta os cards.
 * (Padrão "floating edges" do React Flow.)
 *
 * A geometria das âncoras vive em `@/shared/ui/fluxo/ancoras-aresta` — é a mesma do canvas do
 * Fluxo do Recebimento. Aqui fica só o estilo e o rótulo de cadência, que são desta tela.
 */

interface DadosAresta { ativo?: boolean; concluido?: boolean; reprova?: boolean; cadencia?: number; emRota?: boolean; animarRota?: boolean; atenuado?: boolean; reta?: boolean }

export function FloatingEdge({ id, source, target, markerEnd, data }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const d = (data ?? {}) as DadosAresta

  // `reta` = preferência do usuário (botão na barra): traçado ORTOGONAL (90°), que fica legível
  // quando os cards são arrumados em fileiras esquerda→direita. Padrão = curva (casa com a serpentina).
  // Cada modo tem a SUA âncora: a curva usa a interseção centro-a-centro; o 90° usa o meio do lado.
  const p = d.reta ? ancorasOrtogonal(sourceNode, targetNode) : ancorasCurva(sourceNode, targetNode)
  const geo = {
    sourceX: p.sx, sourceY: p.sy, sourcePosition: p.sourcePos,
    targetX: p.tx, targetY: p.ty, targetPosition: p.targetPos,
  }
  const [path, labelX, labelY] = d.reta
    ? getSmoothStepPath({ ...geo, borderRadius: 6 })
    : getBezierPath(geo)

  // Rótulo da CADÊNCIA do posto de ORIGEM (min/peça = minutos da janela ÷ peças bipadas), no meio da
  // aresta que SAI do posto — só arestas de CADEIA (não reprova) e quando há cadência (posto com bipe na janela).
  // Formato relógio: HH:MM:SS quando ≥ 1h, senão MM:SS.
  const rotulo = !d.reprova && d.cadencia != null ? (
    <EdgeLabelRenderer>
      <div
        className="nodrag nopan pointer-events-none absolute whitespace-nowrap rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-sm"
        style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
      >
        {formatarRelogio(d.cadencia)}
      </div>
    </EdgeLabelRenderer>
  ) : null

  // Busca de SN: aresta NA ROTA → vinho. Só a que está preenchendo AGORA (animarRota) tem a animação
  // (preenche 1×); as já preenchidas viram linha VINHO FIXA (sem classe de animação → nada reinicia).
  if (d.emRota) {
    return (
      <>
        <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: '#8D2033', strokeWidth: 2, opacity: 0.2 }} />
        <path
          d={path}
          fill="none"
          stroke="#8D2033"
          strokeWidth={3.5}
          strokeLinecap="round"
          pathLength={1}
          {...(d.animarRota ? { strokeDasharray: '1', className: 'fluxo-preenche-rota' } : {})}
        />
        {rotulo}
      </>
    )
  }

  // Aresta ATIVA (peça se movendo): linha-base esmaecida + preenchimento animado (fluxo n8n).
  if (d.ativo && !d.atenuado) {
    return (
      <>
        <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: '#8D2033', strokeWidth: 2, opacity: 0.2 }} />
        <path
          d={path}
          fill="none"
          stroke="#8D2033"
          strokeWidth={3}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          className="fluxo-preenche"
        />
        {rotulo}
      </>
    )
  }

  const style = d.reprova
    ? { strokeDasharray: '4 4', stroke: '#8D2033', opacity: 0.35 }
    : d.concluido
      ? { stroke: '#8D2033', strokeWidth: 2 }
      : { stroke: '#94a3b8', strokeWidth: 1 }
  if (d.atenuado) style.opacity = 0.1 // busca de SN ativa e esta aresta está FORA da rota → esmaece

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {d.atenuado ? null : rotulo}
    </>
  )
}
