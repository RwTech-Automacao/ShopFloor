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
      {/* linha-base contínua, esmaecida */}
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, stroke: '#8D2033', strokeWidth: 2, opacity: 0.3 }} />
      {/* streak "passando" por cima (fluxo n8n) — anima o stroke-dashoffset (ver globals.css) */}
      <path d={path} fill="none" stroke="#8D2033" strokeWidth={3} strokeLinecap="round" strokeDasharray="26 150" className="fluxo-streak" />
    </>
  )
}
