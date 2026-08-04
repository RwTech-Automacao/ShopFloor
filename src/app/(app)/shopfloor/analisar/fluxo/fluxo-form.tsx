'use client'

import { useCallback, useState, useTransition } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarFluxo } from '@/modules/shopfloor/application/fluxo-actions'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'
import type { FluxoNodePos, FluxoEdge } from '@/modules/shopfloor/domain/fluxo-op'

function paraNodes(pos: FluxoNodePos[]): Node[] {
  return pos.map((n) => ({ id: n.id, position: { x: n.x, y: n.y }, data: { label: `${n.data.posto} · ${n.data.wip}` } }))
}
function paraEdges(es: FluxoEdge[]): Edge[] {
  return es.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    animated: e.tipo === 'reprova',
    style: e.tipo === 'reprova' ? { strokeDasharray: '4 4' } : undefined,
  }))
}

export function FluxoForm({ ops }: { ops: OpItem[] }) {
  const [sel, setSel] = useState('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [buscou, setBuscou] = useState(false)
  const [carregando, startCarregar] = useTransition()

  const escolher = useCallback((v: string) => {
    setSel(v)
    setBuscou(false)
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    startCarregar(async () => {
      const r = await carregarFluxo(pmo, op)
      if (!r.ok) { toast.error(r.erro); return }
      setNodes(paraNodes(r.nodes))
      setEdges(paraEdges(r.edges))
      setBuscou(true)
    })
  }, [])

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 sm:max-w-md">
          <Label>OP</Label>
          <Select value={sel} onValueChange={(v) => escolher(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="Selecione a OP" /></SelectTrigger>
            <SelectContent>
              {ops.map((o) => (
                <SelectItem key={`${o.pmo}||${o.op}`} value={`${o.pmo}||${o.op}`}>
                  {o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {buscou && !carregando && nodes.length === 0 && (
          <p className="text-sm text-muted-foreground">Esta OP não tem postos no fluxo.</p>
        )}

        <div className="h-[70vh] w-full rounded-lg border border-border">
          <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  )
}
