import { BaseEdge, getBezierPath, useInternalNode, type EdgeProps } from '@xyflow/react'
import { ancorasCurva } from '@/shared/ui/fluxo/ancoras-aresta'

/**
 * Aresta FLUTUANTE do Fluxo do Recebimento: a linha conecta no ponto da borda de cada card que
 * aponta pro outro, então o traçado continua certo depois que o usuário arrasta os cards. A
 * geometria é a mesma do Fluxo do ShopFloor (`@/shared/ui/fluxo/ancoras-aresta`).
 *
 * Três estados, as mesmas cores de lá:
 *  - ramo (Reprovado na Qualidade): tracejado vinho esmaecido, como o ramo da Manutenção;
 *  - cadeia com item na caixa de destino: vinho cheio;
 *  - cadeia com a caixa de destino vazia: cinza fina.
 */
const VINHO = '#8D2033'
const CINZA = '#94a3b8'

interface DadosAresta {
  /** A caixa de destino tem item agora. */
  ativo?: boolean
  /** Saída lateral (Reprovado), não a cadeia. */
  ramo?: boolean
}

export function ArestaFluxo({ id, source, target, markerEnd, data }: EdgeProps) {
  const noOrigem = useInternalNode(source)
  const noDestino = useInternalNode(target)
  if (!noOrigem || !noDestino) return null

  const d = (data ?? {}) as DadosAresta
  const p = ancorasCurva(noOrigem, noDestino)
  const [path] = getBezierPath({
    sourceX: p.sx, sourceY: p.sy, sourcePosition: p.sourcePos,
    targetX: p.tx, targetY: p.ty, targetPosition: p.targetPos,
  })

  const style = d.ramo
    ? { strokeDasharray: '4 4', stroke: VINHO, opacity: 0.35 }
    : d.ativo
      ? { stroke: VINHO, strokeWidth: 2 }
      : { stroke: CINZA, strokeWidth: 1 }

  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
}
