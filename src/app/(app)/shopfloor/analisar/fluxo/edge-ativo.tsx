import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * Aresta ATIVA (peça se movendo, tempo real): linha CONTÍNUA + uma bolinha "andando" ao longo
 * do caminho (estilo n8n). Substitui o tracejado animado do React Flow.
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
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <circle r="4" fill="#8D2033">
        <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
      </circle>
    </>
  )
}
