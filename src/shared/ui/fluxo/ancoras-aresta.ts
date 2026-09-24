import { Position, type InternalNode, type Node } from '@xyflow/react'

/**
 * Âncoras das arestas FLUTUANTES dos canvas de Fluxo (ShopFloor e Recebimento): em vez de sair de um
 * handle fixo, a linha conecta no ponto da BORDA de cada card que aponta pro outro. Assim o traçado
 * fica certo em QUALQUER arranjo — horizontal, em colunas, serpente, diagonal — inclusive quando o
 * usuário arrasta os cards. (Padrão "floating edges" do React Flow.)
 *
 * Funções puras, sem React: as duas telas desenham a aresta do jeito delas e só pedem aqui de onde
 * pra onde a linha vai.
 */

export interface AncorasAresta {
  sx: number
  sy: number
  tx: number
  ty: number
  sourcePos: Position
  targetPos: Position
}

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

/** Âncoras do traçado em CURVA (padrão): a interseção da reta centro-a-centro com cada borda. */
export function ancorasCurva(source: InternalNode<Node>, target: InternalNode<Node>): AncorasAresta {
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
export function ancorasOrtogonal(source: InternalNode<Node>, target: InternalNode<Node>): AncorasAresta {
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
