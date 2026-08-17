import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * Aresta ATIVA (peça se movendo, tempo real): linha-base "vazia" (esmaecida) que vai sendo
 * PREENCHIDA de cor da origem ao destino e recomeça — o fluxo enchendo a linha (estilo n8n).
 */
export function EdgeAtivo({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <>
      {/* linha-base "vazia" (esmaecida) */}
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, stroke: '#8D2033', strokeWidth: 2, opacity: 0.2 }} />
      {/* fluxo n8n: a cor PREENCHE a linha da origem ao destino e recomeça (stroke-dashoffset animado;
          pathLength=1 normaliza o comprimento). Ver keyframe fluxo-preenchendo no globals.css. */}
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
