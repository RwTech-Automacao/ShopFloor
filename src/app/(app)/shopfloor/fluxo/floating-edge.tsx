import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, useInternalNode, Position, type EdgeProps, type InternalNode, type Node } from '@xyflow/react'
import { formatarRelogio } from '@/modules/shopfloor/domain/fluxo-op'

/**
 * Arestas FLUTUANTES: a linha conecta no ponto da BORDA de cada card que aponta pro outro
 * (não em handles fixos esquerda/direita). Assim o traçado fica certo em QUALQUER arranjo —
 * horizontal, em colunas, serpente, diagonal — inclusive quando o usuário arrasta os cards.
 * (Padrão "floating edges" do React Flow.)
 */

/** Ponto onde a reta centro→centro cruza a borda do retângulo do nó `intersectionNode`. */
function interseccao(intersectionNode: InternalNode<Node>, targetNode: InternalNode<Node>) {
  const w = (intersectionNode.measured?.width ?? 0) / 2
  const h = (intersectionNode.measured?.height ?? 0) / 2
  const x2 = intersectionNode.internals.positionAbsolute.x + w
  const y2 = intersectionNode.internals.positionAbsolute.y + h
  const x1 = targetNode.internals.positionAbsolute.x + (targetNode.measured?.width ?? 0) / 2
  const y1 = targetNode.internals.positionAbsolute.y + (targetNode.measured?.height ?? 0) / 2

  const xx1 = (x1 - x2) / (2 * w || 1) - (y1 - y2) / (2 * h || 1)
  const yy1 = (x1 - x2) / (2 * w || 1) + (y1 - y2) / (2 * h || 1)
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1)
  const xx3 = a * xx1
  const yy3 = a * yy1
  return { x: w * (xx3 + yy3) + x2, y: h * (-xx3 + yy3) + y2 }
}

/** Qual lado da borda o ponto tocou (pro getBezierPath curvar pra fora). */
function lado(node: InternalNode<Node>, p: { x: number; y: number }): Position {
  const n = node.internals.positionAbsolute
  const nw = node.measured?.width ?? 0
  const px = Math.round(p.x)
  const py = Math.round(p.y)
  if (px <= Math.round(n.x) + 1) return Position.Left
  if (px >= Math.round(n.x + nw) - 1) return Position.Right
  if (py <= Math.round(n.y) + 1) return Position.Top
  return Position.Bottom // sobra: o ponto está na borda inferior
}

function params(source: InternalNode<Node>, target: InternalNode<Node>) {
  const sp = interseccao(source, target)
  const tp = interseccao(target, source)
  return { sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y, sourcePos: lado(source, sp), targetPos: lado(target, tp) }
}

function centro(n: InternalNode<Node>) {
  const w = n.measured?.width ?? 0
  const h = n.measured?.height ?? 0
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2, w, h }
}

/** Ponto no MEIO do lado escolhido do card. */
function pontoNoLado(c: { x: number; y: number; w: number; h: number }, p: Position) {
  if (p === Position.Bottom) return { x: c.x, y: c.y + c.h / 2 }
  if (p === Position.Top) return { x: c.x, y: c.y - c.h / 2 }
  if (p === Position.Left) return { x: c.x - c.w / 2, y: c.y }
  return { x: c.x + c.w / 2, y: c.y }
}

/**
 * Âncoras do traçado ORTOGONAL (90°). Diferente da curva, aqui NÃO se usa a interseção da reta
 * centro-a-centro: escolhe-se o LADO de saída/entrada e ancora-se no meio dele.
 *  - Mudou de linha (dy relevante): sai por BAIXO (ou por cima) → a linha DESCE primeiro e só
 *    depois vira; entra pela lateral que dá de frente (ou pelo topo, se estiver logo abaixo).
 *  - Mesma linha: sai/entra pelas laterais, direto.
 */
function ortogonal(source: InternalNode<Node>, target: InternalNode<Node>) {
  const s = centro(source)
  const t = centro(target)
  const dx = t.x - s.x
  const dy = t.y - s.y
  const mudaLinha = Math.abs(dy) > Math.max(s.h, 1) * 0.75

  let sourcePos: Position
  let targetPos: Position
  if (mudaLinha) {
    // Sai pela base (desce primeiro) e SEMPRE entra pelo topo do destino. Assim o trecho horizontal
    // corre no ESPAÇO ENTRE AS FILEIRAS, e não na altura dos cards — senão a linha passa atrás deles.
    sourcePos = dy > 0 ? Position.Bottom : Position.Top
    targetPos = dy > 0 ? Position.Top : Position.Bottom
  } else {
    sourcePos = dx > 0 ? Position.Right : Position.Left
    targetPos = dx > 0 ? Position.Left : Position.Right
  }

  const sp = pontoNoLado(s, sourcePos)
  const tp = pontoNoLado(t, targetPos)
  return { sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y, sourcePos, targetPos }
}

interface DadosAresta { ativo?: boolean; concluido?: boolean; reprova?: boolean; cadencia?: number; emRota?: boolean; animarRota?: boolean; atenuado?: boolean; reta?: boolean }

export function FloatingEdge({ id, source, target, markerEnd, data }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const d = (data ?? {}) as DadosAresta

  // `reta` = preferência do usuário (botão na barra): traçado ORTOGONAL (90°), que fica legível
  // quando os cards são arrumados em fileiras esquerda→direita. Padrão = curva (casa com a serpentina).
  // Cada modo tem a SUA âncora: a curva usa a interseção centro-a-centro; o 90° usa o meio do lado.
  const p = d.reta ? ortogonal(sourceNode, targetNode) : params(sourceNode, targetNode)
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
