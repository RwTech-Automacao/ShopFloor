'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { ReactFlow, Background, Controls, useNodesState, type Node, type Edge, type NodeTypes, type NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarFluxo, detalhePosto, snsManutencao, burninDetalhe, embalagemCaixas } from '@/modules/shopfloor/application/fluxo-actions'
import type { OpItem, SnDoPosto, BurninEmAndamento, BurninDetalhe, EmbalagemCaixa } from '@/modules/shopfloor/infra/fluxo-repository'
import { MANUTENCAO, type FluxoNodePos, type FluxoEdge, type PassagemPosto } from '@/modules/shopfloor/domain/fluxo-op'
import { formatarDuracao } from '@/modules/shopfloor/domain/burnin'
import { FluxoNode, type FluxoNodePayload } from './fluxo-node'
import { HistoricoSnDialog } from './historico-sn-dialog'
import { EdgeAtivo } from './edge-ativo'

interface Listas { agora: SnDoPosto[]; historico: PassagemPosto[] }
const LISTAS_VAZIAS: Listas = { agora: [], historico: [] }
const BURNIN_VAZIO: BurninDetalhe = { emAndamento: [], entradas: [], saidas: [] }

/** hh:mm dd/mm — data/hora compacta pros eventos de Burn-in. */
function fmtHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function paraEdges(es: FluxoEdge[], nodesData: FluxoNodePos[]): Edge[] {
  const dataDe = (id: string) => nodesData.find((n) => n.id === id)?.data
  return es.map((e) => {
    // "Andando" (preenchendo) só onde há peça se movendo: cadeia = pendentes no destino; reprova = peça em Manutenção.
    const ativo = e.tipo === 'reprova' ? (dataDe(MANUTENCAO)?.wip ?? 0) > 0 : (dataDe(e.target)?.wip ?? 0) > 0
    if (ativo) {
      // aresta ativa: preenchimento animado (fluxo n8n)
      return { id: e.id, source: e.source, target: e.target, type: 'ativo', style: { stroke: '#8D2033', strokeWidth: 2 } }
    }
    // destino já CONCLUÍDO (posto com o check) → trilha percorrida = linha vinho sólida.
    if (e.tipo !== 'reprova' && dataDe(e.target)?.concluido) {
      return { id: e.id, source: e.source, target: e.target, style: { stroke: '#8D2033', strokeWidth: 2 } }
    }
    // parada: cadeia cinza fina; reprova tracejada esmaecida (marcador de rota)
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      style:
        e.tipo === 'reprova'
          ? { strokeDasharray: '4 4', stroke: '#8D2033', opacity: 0.35 }
          : { stroke: '#94a3b8', strokeWidth: 1 },
    }
  })
}

/** Nº de Série clicável → abre a linha do tempo do produto. */
function SnBotao({ sn, sufixo, onSn }: { sn: string; sufixo?: string; onSn: (sn: string) => void }) {
  return (
    <button type="button" onClick={() => onSn(sn)} className="text-left hover:text-enterplak hover:underline">
      {sn}{sufixo ?? ''}
    </button>
  )
}

/** Lista de SNs com título + contagem (reusada nas seções do painel). */
function ListaSns({ titulo, itens, carregando, onSn }: { titulo: string; itens: SnDoPosto[]; carregando: boolean; onSn: (sn: string) => void }) {
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
              <SnBotao sn={s.sn} onSn={onSn} />
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
function ListaPassagens({ titulo, itens, carregando, onSn }: { titulo: string; itens: PassagemPosto[]; carregando: boolean; onSn: (sn: string) => void }) {
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
              <SnBotao sn={p.sn} sufixo={p.total > 1 ? ` ${p.ordinal}x` : ''} onSn={onSn} />
              <span className="text-muted-foreground">{p.status || '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Burn-in "No posto agora": peças com ciclo aberto (cozinhando) + há quanto tempo (relógio ao vivo). */
function ListaBurnin({ itens, agoraMs, carregando, onSn }: { itens: BurninEmAndamento[]; agoraMs: number; carregando: boolean; onSn: (sn: string) => void }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pendentes no posto ({itens.length})</p>
      {carregando ? (
        <p className="text-muted-foreground">Carregando…</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {itens.length === 0 && <li className="text-muted-foreground">—</li>}
          {itens.map((b, i) => {
            const min = Math.max(0, Math.round((agoraMs - Date.parse(b.desde)) / 60000))
            return (
              <li key={`${b.sn}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
                <SnBotao sn={b.sn} onSn={onSn} />
                <span className="text-muted-foreground">há {formatarDuracao(min)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Lista simples SN + texto à direita (usada pras listas de Entrada/Saída do Burn-in e Embalagem). */
function ListaSimples({ titulo, itens, onSn }: { titulo: string; itens: { sn: string; dir: string }[]; onSn: (sn: string) => void }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo} ({itens.length})</p>
      <ul className="flex flex-col gap-0.5">
        {itens.length === 0 && <li className="text-muted-foreground">—</li>}
        {itens.map((e, i) => (
          <li key={`${e.sn}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
            <SnBotao sn={e.sn} onSn={onSn} />
            <span className="text-muted-foreground">{e.dir}</span>
          </li>
        ))}
      </ul>
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
  const [burnin, setBurnin] = useState<BurninDetalhe>(BURNIN_VAZIO)
  const [caixas, setCaixas] = useState<EmbalagemCaixa[]>([])
  const [snAberto, setSnAberto] = useState<string | null>(null) // linha do tempo do produto
  const [carregando, startCarregar] = useTransition()
  const [carregandoSns, startSns] = useTransition()
  const ctx = useRef<{ pmo: string; op: string }>({ pmo: '', op: '' })
  // Nós gerenciados pelo React Flow (arrastáveis). A posição do usuário é preservada entre atualizações.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [atualizadoMs, setAtualizadoMs] = useState<number | null>(null) // tempo real: quando atualizou por último

  // Relógio ao vivo pro "há X" do Burn-in (atualiza a cada minuto).
  const [agoraMs, setAgoraMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgoraMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const nodeTypes = useMemo<NodeTypes>(() => ({ fluxo: FluxoNode }), [])
  const edgeTypes = useMemo(() => ({ ativo: EdgeAtivo }), [])

  const abrir = useCallback((id: string) => {
    setListas(LISTAS_VAZIAS)
    setBurnin(BURNIN_VAZIO)
    setCaixas([])
    setAberto((a) => (a === id ? null : id))
    if (aberto === id) return
    const { pmo, op } = ctx.current
    const recurso = dom.find((n) => n.id === id)?.data.recurso
    startSns(async () => {
      if (id === MANUTENCAO) {
        // Manutenção é ramo: só "agora" = peças travadas (último bipe reprovado), coerente com o badge.
        const r = await snsManutencao(pmo, op)
        if (r.ok) setListas({ agora: r.sns, historico: [] })
        else toast.error(r.erro)
      } else {
        const r = await detalhePosto(pmo, op, id)
        if (!r.ok) { toast.error(r.erro); return }
        setListas({ agora: r.agora, historico: r.historico })
        // Burn-in: cozinhando (ciclo aberto) + eventos de entrada e saída separados.
        if (recurso === 'burnin') {
          const b = await burninDetalhe(pmo, op, id)
          if (b.ok) setBurnin(b.detalhe)
        } else if (recurso === 'caixa') {
          // Embalagem: cada peça + em qual caixa está.
          const c = await embalagemCaixas(pmo, op, id)
          if (c.ok) setCaixas(c.itens)
        }
      }
    })
  }, [aberto, dom])

  const onNodeClick = useCallback<NodeMouseHandler>((_, node) => abrir(node.id), [abrir])

  const escolher = useCallback((v: string) => {
    setSel(v); setBuscou(false); setAberto(null); setListas(LISTAS_VAZIAS); setBurnin(BURNIN_VAZIO)
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    ctx.current = { pmo, op }
    startCarregar(async () => {
      const r = await carregarFluxo(pmo, op)
      if (!r.ok) { toast.error(r.erro); return }
      setDom(r.nodes)
      setEdges(paraEdges(r.edges, r.nodes))
      setAtualizadoMs(Date.now())
      setBuscou(true)
    })
  }, [])

  // Sincroniza os nós com o domínio (badges/estado) preservando a posição arrastada pelo usuário.
  useEffect(() => {
    setNodes((prev) => {
      const posById = new Map(prev.map((n) => [n.id, n.position]))
      return dom.map((n) => ({
        id: n.id,
        type: 'fluxo',
        position: posById.get(n.id) ?? { x: n.x, y: n.y },
        data: { ...n.data, selecionado: aberto === n.id } satisfies FluxoNodePayload,
      }))
    })
  }, [dom, aberto, setNodes])

  // Tempo real: enquanto uma OP está aberta, re-busca o fluxo (números + linhas "andando") a cada 15s.
  useEffect(() => {
    if (!buscou) return
    const { pmo, op } = ctx.current
    const t = setInterval(async () => {
      const r = await carregarFluxo(pmo, op)
      if (r.ok) {
        setDom(r.nodes)
        setEdges(paraEdges(r.edges, r.nodes))
        setAtualizadoMs(Date.now())
      }
    }, 15_000)
    return () => clearInterval(t)
  }, [buscou, sel])

  const detalhe = aberto ? dom.find((n) => n.id === aberto)?.data : undefined
  // Postos da OP em ordem (sem Manutenção) — pra timeline mostrar até os postos ainda não alcançados.
  const postosOP = useMemo(() => dom.filter((n) => n.id !== MANUTENCAO).map((n) => n.id), [dom])

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-1 flex-col gap-1.5 sm:max-w-md sm:min-w-64">
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
          {buscou && atualizadoMs !== null && (
            <span className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground" title="Atualiza automaticamente a cada 15s">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
              </span>
              Ao vivo · atualiza a cada 15s
            </span>
          )}
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
            edgeTypes={edgeTypes}
            fitView
            nodesDraggable
            nodesConnectable={false}
            onNodesChange={onNodesChange}
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
                    <ListaSns titulo="Peças travadas" itens={listas.agora} carregando={carregandoSns} onSn={setSnAberto} />
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Pendentes: <span className="font-bold">{detalhe.wip}</span></span>
                      {detalhe.temStatus ? (
                        <>
                          <span className="text-green-700">Aprov.: {detalhe.aprovadas}</span>
                          <span className="text-red-600">Reprov.: {detalhe.reprovadas}</span>
                          {/* Burn-in tem entrada+saída → "retestes" da RPC não faz sentido lá. */}
                          {detalhe.recurso !== 'burnin' && (
                            <span className="text-muted-foreground">Retestes: {detalhe.retestes}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Registradas: {detalhe.registros}</span>
                      )}
                    </div>
                    {detalhe.recurso === 'burnin' ? (
                      <>
                        <ListaBurnin itens={burnin.emAndamento} agoraMs={agoraMs} carregando={carregandoSns} onSn={setSnAberto} />
                        <ListaSimples titulo="Entrada" itens={burnin.entradas.map((e) => ({ sn: e.sn, dir: fmtHora(e.dataHora) }))} onSn={setSnAberto} />
                        <ListaSimples titulo="Saída" itens={burnin.saidas.map((s) => ({ sn: s.sn, dir: s.status }))} onSn={setSnAberto} />
                      </>
                    ) : detalhe.recurso === 'caixa' ? (
                      <ListaSimples titulo="Embaladas (peça · caixa)" itens={caixas.map((c) => ({ sn: c.sn, dir: c.caixa }))} onSn={setSnAberto} />
                    ) : (
                      <>
                        <ListaSns titulo="Pendentes no posto" itens={listas.agora} carregando={carregandoSns} onSn={setSnAberto} />
                        <ListaPassagens titulo="Histórico do posto" itens={listas.historico} carregando={carregandoSns} onSn={setSnAberto} />
                      </>
                    )}
                  </>
                )}
              </div>
            </aside>
          )}
        </div>

        <HistoricoSnDialog sn={snAberto} postosOP={postosOP} onFechar={() => setSnAberto(null)} />
      </CardContent>
    </Card>
  )
}
