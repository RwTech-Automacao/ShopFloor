'use client'

import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge, type NodeTypes, type NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X } from 'lucide-react'
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
    style: e.tipo === 'reprova' ? { strokeDasharray: '4 4', stroke: '#f59e0b' } : { stroke: '#a3a3a3' },
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

  const abrir = useCallback((id: string) => {
    setSns([])
    setAberto((a) => (a === id ? null : id))
    if (aberto === id) return
    const { pmo, op } = ctx.current
    startSns(async () => {
      // Manutenção é ramo: detalhe = peças que estão nela agora (último bipe reprovado), coerente com o badge.
      const r = id === MANUTENCAO ? await snsManutencao(pmo, op) : await snsDoPosto(pmo, op, id)
      if (r.ok) setSns(r.sns)
      else toast.error(r.erro)
    })
  }, [aberto])

  const onNodeClick = useCallback<NodeMouseHandler>((_, node) => abrir(node.id), [abrir])

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
    data: { ...n.data, selecionado: aberto === n.id } satisfies FluxoNodePayload,
  })), [dom, aberto])

  const detalhe = aberto ? dom.find((n) => n.id === aberto)?.data : undefined

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

        <div className="relative h-[70vh] w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={onNodeClick}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>

          {detalhe && (
            <aside className="absolute right-0 top-0 flex h-full w-80 max-w-[85%] flex-col border-l border-neutral-800 bg-neutral-900/95 text-neutral-100 backdrop-blur">
              <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{detalhe.posto}</p>
                  <p className="text-xs text-neutral-400">
                    {detalhe.ehManutencao ? 'Ramo · Manutenção' : detalhe.concluido ? 'Concluído' : detalhe.temStatus ? 'Teste/Inspeção' : 'Passagem'}
                  </p>
                </div>
                <button type="button" onClick={() => setAberto(null)} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100" aria-label="Fechar">
                  <X className="size-4" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
                {detalhe.ehManutencao ? (
                  <p className="mb-3 text-amber-400">Em manutenção agora: <span className="font-bold">{detalhe.wip}</span></p>
                ) : (
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                    <span>No posto agora: <span className="font-bold">{detalhe.wip}</span></span>
                    {detalhe.temStatus ? (
                      <>
                        <span className="text-green-400">Aprov.: {detalhe.aprovadas}</span>
                        <span className="text-red-400">Reprov.: {detalhe.reprovadas}</span>
                        <span className="text-neutral-400">Retestes: {detalhe.retestes}</span>
                      </>
                    ) : (
                      <span className="text-neutral-400">Registradas: {detalhe.registros}</span>
                    )}
                  </div>
                )}

                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {detalhe.ehManutencao ? 'Peças travadas' : 'Nº de Série'} ({sns.length})
                </p>
                {carregandoSns ? (
                  <p className="text-neutral-400">Carregando…</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {sns.length === 0 && <li className="text-neutral-500">—</li>}
                    {sns.map((s, i) => (
                      <li key={`${s.sn}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
                        <span>{s.sn}</span>
                        <span className="text-neutral-400">{s.status || '—'}{s.vezes > 1 ? ` ×${s.vezes}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
