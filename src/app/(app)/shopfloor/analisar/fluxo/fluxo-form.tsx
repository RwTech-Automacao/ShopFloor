'use client'

import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarFluxo, snsDoPosto, snsManutencao } from '@/modules/shopfloor/application/fluxo-actions'
import type { OpItem, SnDoPosto } from '@/modules/shopfloor/infra/fluxo-repository'
import { MANUTENCAO, type FluxoNodePos, type FluxoEdge } from '@/modules/shopfloor/domain/fluxo-op'
import { FluxoNode, type FluxoNodePayload } from './fluxo-node'

function paraEdges(es: FluxoEdge[]): Edge[] {
  return es.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    animated: e.tipo === 'reprova',
    style: e.tipo === 'reprova' ? { strokeDasharray: '4 4' } : undefined,
  }))
}

export function FluxoForm({ ops }: { ops: OpItem[] }) {
  const [sel, setSel] = useState('')
  const [dom, setDom] = useState<FluxoNodePos[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [aberto, setAberto] = useState<string | null>(null)
  const [sns, setSns] = useState<SnDoPosto[]>([])
  const [buscou, setBuscou] = useState(false)
  const [carregando, startCarregar] = useTransition()
  const [carregandoSns, startSns] = useTransition()
  const ctx = useRef<{ pmo: string; op: string }>({ pmo: '', op: '' })

  const nodeTypes = useMemo<NodeTypes>(() => ({ fluxo: FluxoNode }), [])

  const onAbrir = useCallback((posto: string) => {
    setAberto((a) => (a === posto ? null : posto))
    setSns([])
    if (aberto === posto) return
    const { pmo, op } = ctx.current
    startSns(async () => {
      // Manutenção é ramo: o detalhe são as peças que estão nela agora (último bipe reprovado),
      // coerente com o badge (WIP). Os demais postos listam quem passou por ali (histórico).
      const r = posto === MANUTENCAO ? await snsManutencao(pmo, op) : await snsDoPosto(pmo, op, posto)
      if (r.ok) setSns(r.sns)
      else toast.error(r.erro)
    })
  }, [aberto])

  const escolher = useCallback((v: string) => {
    setSel(v); setBuscou(false); setAberto(null); setSns([])
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    ctx.current = { pmo, op }
    startCarregar(async () => {
      const r = await carregarFluxo(pmo, op)
      if (!r.ok) { toast.error(r.erro); return }
      setDom(r.nodes)
      setEdges(paraEdges(r.edges))
      setBuscou(true)
    })
  }, [])

  const nodes = useMemo<Node[]>(() => dom.map((n) => ({
    id: n.id,
    type: 'fluxo',
    position: { x: n.x, y: n.y },
    data: {
      ...n.data,
      aberto: aberto === n.id,
      carregandoSns: aberto === n.id && carregandoSns,
      sns: aberto === n.id ? sns : [],
      onAbrir,
    } satisfies FluxoNodePayload,
  })), [dom, aberto, sns, carregandoSns, onAbrir])

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
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  )
}
