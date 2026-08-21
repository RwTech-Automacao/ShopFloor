import { BaseEdge, getBezierPath, useInternalNode, Position, type EdgeProps, type InternalNode, type Node } from '@xyflow/react'

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
  const nh = node.measured?.height ?? 0
  const px = Math.round(p.x)
  const py = Math.round(p.y)
  if (px <= Math.round(n.x) + 1) return Position.Left
  if (px >= Math.round(n.x + nw) - 1) return Position.Right
  if (py <= Math.round(n.y) + 1) return Position.Top
  return Position.Bottom
}

function params(source: InternalNode<Node>, target: InternalNode<Node>) {
  const sp = interseccao(source, target)
  const tp = interseccao(target, source)
  return { sx: sp.x, sy: sp.y, tx: tp.x, ty: tp.y, sourcePos: lado(source, sp), targetPos: lado(target, tp) }
}

interface DadosAresta { ativo?: boolean; concluido?: boolean; reprova?: boolean }

export function FloatingEdge({ id, source, target, markerEnd, data }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const { sx, sy, tx, ty, sourcePos, targetPos } = params(sourceNode, targetNode)
  const [path] = getBezierPath({
    sourceX: sx, sourceY: sy, sourcePosition: sourcePos,
    targetX: tx, targetY: ty, targetPosition: targetPos,
  })

  const d = (data ?? {}) as DadosAresta

  // Aresta ATIVA (peça se movendo): linha-base esmaecida + preenchimento animado (fluxo n8n).
  if (d.ativo) {
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
      </>
    )
  }

  const style = d.reprova
    ? { strokeDasharray: '4 4', stroke: '#8D2033', opacity: 0.35 }
    : d.concluido
      ? { stroke: '#8D2033', strokeWidth: 2 }
      : { stroke: '#94a3b8', strokeWidth: 1 }

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
}
