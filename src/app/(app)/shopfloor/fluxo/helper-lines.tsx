'use client'

import { useEffect, useRef } from 'react'
import { useStore, type Node, type NodePositionChange, type ReactFlowState, type XYPosition } from '@xyflow/react'

export interface HelperLinesResult {
  horizontal?: number
  vertical?: number
  snapPosition: Partial<XYPosition>
}

/**
 * Calcula as linhas-guia de alinhamento ao arrastar um nó: compara as bordas/centro do nó movido
 * com os demais e, se ficar dentro de `distancia`, "gruda" no alinhamento e devolve a coordenada da
 * guia (horizontal/vertical). Adaptado do exemplo oficial "Helper Lines" do React Flow. Puro.
 */
export function getHelperLines(change: NodePositionChange, nodes: Node[], distancia = 6): HelperLinesResult {
  const padrao: HelperLinesResult = { horizontal: undefined, vertical: undefined, snapPosition: { x: undefined, y: undefined } }
  const nodeA = nodes.find((n) => n.id === change.id)
  if (!nodeA || !change.position) return padrao

  const aW = nodeA.measured?.width ?? 0
  const aH = nodeA.measured?.height ?? 0
  const a = {
    left: change.position.x,
    right: change.position.x + aW,
    top: change.position.y,
    bottom: change.position.y + aH,
    width: aW,
    height: aH,
  }

  let distV = distancia
  let distH = distancia

  return nodes
    .filter((n) => n.id !== nodeA.id)
    .reduce<HelperLinesResult>((res, nodeB) => {
      const bW = nodeB.measured?.width ?? 0
      const bH = nodeB.measured?.height ?? 0
      const b = { left: nodeB.position.x, right: nodeB.position.x + bW, top: nodeB.position.y, bottom: nodeB.position.y + bH, width: bW, height: bH }

      // Alinhamentos verticais (esq-esq, dir-dir, centro-x)
      const dLL = Math.abs(a.left - b.left)
      if (dLL < distV) { res.snapPosition.x = b.left; res.vertical = b.left; distV = dLL }
      const dRR = Math.abs(a.right - b.right)
      if (dRR < distV) { res.snapPosition.x = b.right - a.width; res.vertical = b.right; distV = dRR }
      const dCX = Math.abs(a.left + a.width / 2 - (b.left + b.width / 2))
      if (dCX < distV) { res.snapPosition.x = b.left + b.width / 2 - a.width / 2; res.vertical = b.left + b.width / 2; distV = dCX }

      // Alinhamentos horizontais (topo-topo, base-base, centro-y)
      const dTT = Math.abs(a.top - b.top)
      if (dTT < distH) { res.snapPosition.y = b.top; res.horizontal = b.top; distH = dTT }
      const dBB = Math.abs(a.bottom - b.bottom)
      if (dBB < distH) { res.snapPosition.y = b.bottom - a.height; res.horizontal = b.bottom; distH = dBB }
      const dCY = Math.abs(a.top + a.height / 2 - (b.top + b.height / 2))
      if (dCY < distH) { res.snapPosition.y = b.top + b.height / 2 - a.height / 2; res.horizontal = b.top + b.height / 2; distH = dCY }

      return res
    }, padrao)
}

const seletor = (s: ReactFlowState) => ({ width: s.width, height: s.height, transform: s.transform })

/** Desenha as linhas-guia (vinho) sobre o canvas, na coordenada da tela (aplica o transform do RF). */
export function HelperLines({ horizontal, vertical }: { horizontal?: number; vertical?: number }) {
  const { width, height, transform } = useStore(seletor)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpi = window.devicePixelRatio || 1
    canvas.width = width * dpi
    canvas.height = height * dpi
    ctx.scale(dpi, dpi)
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = '#8D2033'
    ctx.lineWidth = 1

    if (typeof vertical === 'number') {
      const x = vertical * transform[2] + transform[0]
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke()
    }
    if (typeof horizontal === 'number') {
      const y = horizontal * transform[2] + transform[1]
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
    }
  }, [width, height, transform, horizontal, vertical])

  return <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0 z-10 h-full w-full" />
}
