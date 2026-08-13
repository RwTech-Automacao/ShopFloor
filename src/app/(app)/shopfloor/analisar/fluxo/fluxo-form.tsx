'use client'

import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import { ReactFlow, Background, Controls, type Node, type Edge, type NodeTypes, type NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarFluxo, detalhePosto, snsManutencao } from '@/modules/shopfloor/application/fluxo-actions'
import type { OpItem, SnDoPosto } from '@/modules/shopfloor/infra/fluxo-repository'
import { MANUTENCAO, type FluxoNodePos, type FluxoEdge, type PassagemPosto } from '@/modules/shopfloor/domain/fluxo-op'
import { FluxoNode, type FluxoNodePayload } from './fluxo-node'

interface Listas { agora: SnDoPosto[]; historico: PassagemPosto[] }
const LISTAS_VAZIAS: Listas = { agora: [], historico: [] }

function paraEdges(es: FluxoEdge[]): Edge[] {
  return es.map((e) => ({
    id: e.id, source: e.source, target: e.target,
    animated: e.tipo === 'reprova',
    // reprova → Manutenção em vermelho do sistema (tracejada); cadeia em cinza.
    style: e.tipo === 'reprova' ? { strokeDasharray: '4 4', stroke: '#8D2033' } : { stroke: '#94a3b8' },
  }))
}

/** Lista de SNs com título + contagem (reusada nas seções do painel). */
function ListaSns({ titulo, itens, carregando }: { titulo: string; itens: SnDoPosto[]; carregando: boolean }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo} ({itens.length})</p>
      {carregando ? (
        <p className="text-muted-foreground">Carregando…</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {itens.length === 0 && <li className="text-muted-foreground">—</li>}
          {itens.map((s, i) => (
            <li key={`${s.sn}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
              <span>{s.sn}</span>
              <span className="text-muted-foreground">{s.status || '—'}{s.vezes > 1 ? ` ×${s.vezes}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Histórico do posto: uma linha por PASSAGEM. Quem passou >1 vez mostra "Nx status" em cada
 *  passagem (1x = 1ª vez); quem passou 1 vez mostra só o SN. */
function ListaPassagens({ titulo, itens, carregando }: { titulo: string; itens: PassagemPosto[]; carregando: boolean }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo} ({itens.length})</p>
      {carregando ? (
        <p className="text-muted-foreground">Carregando…</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {itens.length === 0 && <li className="text-muted-foreground">—</li>}
          {itens.map((p, i) => (
            <li key={`${p.sn}-${p.ordinal}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
              <span>{p.sn}</span>
              {p.total > 1 && <span className="text-muted-foreground">{p.ordinal}x {p.status || '—'}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function FluxoForm({ ops }: { ops: OpItem[] }) {
  const [sel, setSel] = useState('')
  const [dom, setDom] = useState<FluxoNodePos[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [aberto, setAberto] = useState<string | null>(null)
  const [listas, setListas] = useState<Listas>(LISTAS_VAZIAS)
  const [buscou, setBuscou] = useState(false)
  const [carregando, startCarregar] = useTransition()
  const [carregandoSns, startSns] = useTransition()
  const ctx = useRef<{ pmo: string; op: string }>({ pmo: '', op: '' })

  const nodeTypes = useMemo<NodeTypes>(() => ({ fluxo: FluxoNode }), [])

  const abrir = useCallback((id: string) => {
    setListas(LISTAS_VAZIAS)
    setAberto((a) => (a === id ? null : id))
    if (aberto === id) return
    const { pmo, op } = ctx.current
    startSns(async () => {
      if (id === MANUTENCAO) {
        // Manutenção é ramo: só "agora" = peças travadas (último bipe reprovado), coerente com o badge.
        const r = await snsManutencao(pmo, op)
        if (r.ok) setListas({ agora: r.sns, historico: [] })
        else toast.error(r.erro)
      } else {
        const r = await detalhePosto(pmo, op, id)
        if (r.ok) setListas({ agora: r.agora, historico: r.historico })
        else toast.error(r.erro)
      }
    })
  }, [aberto])

  const onNodeClick = useCallback<NodeMouseHandler>((_, node) => abrir(node.id), [abrir])

  const escolher = useCallback((v: string) => {
    setSel(v); setBuscou(false); setAberto(null); setListas(LISTAS_VAZIAS)
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

        <div className="relative h-[70vh] w-full overflow-hidden rounded-lg border border-border bg-neutral-100">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={onNodeClick}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>

          {detalhe && (
            <aside className="absolute right-0 top-0 flex h-full w-80 max-w-[85%] flex-col border-l border-border bg-card/95 text-foreground shadow-lg backdrop-blur">
              <header className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{detalhe.posto}</p>
                  <p className="text-xs text-muted-foreground">
                    {detalhe.ehManutencao ? 'Ramo · Manutenção' : detalhe.concluido ? 'Concluído' : detalhe.temStatus ? 'Teste/Inspeção' : 'Passagem'}
                  </p>
                </div>
                <button type="button" onClick={() => setAberto(null)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Fechar">
                  <X className="size-4" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
                {detalhe.ehManutencao ? (
                  <>
                    <p className="mb-3 text-enterplak">Em manutenção agora: <span className="font-bold">{detalhe.wip}</span></p>
                    <ListaSns titulo="Peças travadas" itens={listas.agora} carregando={carregandoSns} />
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                      <span>No posto agora: <span className="font-bold">{detalhe.wip}</span></span>
                      {detalhe.temStatus ? (
                        <>
                          <span className="text-green-700">Aprov.: {detalhe.aprovadas}</span>
                          <span className="text-red-600">Reprov.: {detalhe.reprovadas}</span>
                          <span className="text-muted-foreground">Retestes: {detalhe.retestes}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Registradas: {detalhe.registros}</span>
                      )}
                    </div>
                    <ListaSns titulo="No posto agora" itens={listas.agora} carregando={carregandoSns} />
                    <ListaPassagens titulo="Histórico do posto" itens={listas.historico} carregando={carregandoSns} />
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
