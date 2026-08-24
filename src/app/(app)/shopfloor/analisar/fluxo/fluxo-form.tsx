'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { ReactFlow, Background, Controls, useNodesState, type Node, type Edge, type NodeChange, type NodeTypes, type NodeMouseHandler, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X, Maximize2, Minimize2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarFluxo, detalhePosto, snsManutencao, burninDetalhe, embalagemCaixas } from '@/modules/shopfloor/application/fluxo-actions'
import type { OpItem, SnDoPosto, BurninEmAndamento, BurninDetalhe, EmbalagemCaixa } from '@/modules/shopfloor/infra/fluxo-repository'
import { MANUTENCAO, ENTRADA, SAIDA, type FluxoNodePos, type FluxoEdge, type PassagemPosto } from '@/modules/shopfloor/domain/fluxo-op'
import { formatarDuracao } from '@/modules/shopfloor/domain/burnin'
import { FluxoNode, type FluxoNodePayload } from './fluxo-node'
import { HistoricoSnDialog } from './historico-sn-dialog'
import { FloatingEdge } from './floating-edge'
import { HelperLines, getHelperLines } from './helper-lines'

/** Posições salvas por OP (layout do usuário) — nesta máquina. */
const chaveLayout = (pmo: string, op: string) => `sf:fluxo:pos:${pmo}:${op}`
function lerLayout(pmo: string, op: string): Map<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(chaveLayout(pmo, op))
    if (!raw) return new Map()
    return new Map(Object.entries(JSON.parse(raw) as Record<string, { x: number; y: number }>))
  } catch {
    return new Map()
  }
}

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
  // Todas as arestas são FLUTUANTES (o traçado se ajusta a qualquer arranjo dos cards). A aparência
  // vem do `data`: ativo = peça andando (preenchimento animado); concluido = trilha vinho sólida;
  // reprova = tracejado esmaecido; senão cinza fino. "Andando" = pendentes no destino (reprova = em Manutenção).
  return es.map((e) => {
    const reprova = e.tipo === 'reprova'
    const ativo = reprova ? (dataDe(MANUTENCAO)?.wip ?? 0) > 0 : (dataDe(e.target)?.wip ?? 0) > 0
    const concluido = !reprova && (dataDe(e.target)?.concluido ?? false)
    return { id: e.id, source: e.source, target: e.target, type: 'floating', data: { ativo, concluido, reprova, segundos: e.segundos } }
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
  const layoutRef = useRef<Map<string, { x: number; y: number }>>(new Map()) // posições salvas da OP (localStorage)
  const [guiaH, setGuiaH] = useState<number | undefined>(undefined) // linha-guia horizontal ao arrastar
  const [guiaV, setGuiaV] = useState<number | undefined>(undefined) // linha-guia vertical ao arrastar
  const [atualizadoMs, setAtualizadoMs] = useState<number | null>(null) // tempo real: quando atualizou por último
  const [qtd, setQtd] = useState<number | null>(null) // qtd da OP (pro % de progresso no Modo TV)
  const [filtroOp, setFiltroOp] = useState('') // busca do dropdown de OP
  const [layoutCard, setLayoutCard] = useState<'a' | 'b'>('a') // toggle de layout do card (só p/ apresentação)

  // Relógio ao vivo pro "há X" do Burn-in (atualiza a cada minuto).
  const [agoraMs, setAgoraMs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgoraMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const nodeTypes = useMemo<NodeTypes>(() => ({ fluxo: FluxoNode }), [])
  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), [])

  const abrir = useCallback((id: string) => {
    // Caixas de Entrada/Saída não têm detalhe (só a contagem) — clique é inerte.
    const dataDo = dom.find((n) => n.id === id)?.data
    if (dataDo?.ehEntrada || dataDo?.ehSaida) return
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

  // Arrastar: aplica snap de alinhamento + mostra a linha-guia (só quando arrastando 1 nó).
  const onNodesChangeGuia = useCallback((changes: NodeChange[]) => {
    setGuiaH(undefined)
    setGuiaV(undefined)
    const c = changes[0]
    if (changes.length === 1 && c && c.type === 'position' && c.dragging && c.position) {
      const helper = getHelperLines(c, nodes)
      c.position.x = helper.snapPosition.x ?? c.position.x
      c.position.y = helper.snapPosition.y ?? c.position.y
      setGuiaH(helper.horizontal)
      setGuiaV(helper.vertical)
    }
    onNodesChange(changes)
  }, [nodes, onNodesChange])

  // Salva o layout (posição de cada nó) da OP no localStorage desta máquina.
  const salvarLayout = useCallback(() => {
    const { pmo, op } = ctx.current
    if (!pmo || !op) return
    setNodes((cur) => {
      const mapa: Record<string, { x: number; y: number }> = {}
      for (const n of cur) mapa[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
      layoutRef.current = new Map(Object.entries(mapa))
      try { localStorage.setItem(chaveLayout(pmo, op), JSON.stringify(mapa)) } catch { /* storage cheio/off */ }
      return cur
    })
  }, [setNodes])

  const onNodeDragStop = useCallback(() => { setGuiaH(undefined); setGuiaV(undefined); salvarLayout() }, [salvarLayout])

  const escolher = useCallback((v: string) => {
    setSel(v); setBuscou(false); setAberto(null); setListas(LISTAS_VAZIAS); setBurnin(BURNIN_VAZIO)
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    ctx.current = { pmo, op }
    layoutRef.current = lerLayout(pmo, op) // recupera o arranjo salvo desta OP nesta máquina
    startCarregar(async () => {
      const r = await carregarFluxo(pmo, op)
      if (!r.ok) { toast.error(r.erro); return }
      setDom(r.nodes)
      setEdges(paraEdges(r.edges, r.nodes))
      setQtd(r.qtd)
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
        // prioridade: posição arrastada na sessão → layout salvo da OP → posição padrão do domínio.
        position: posById.get(n.id) ?? layoutRef.current.get(n.id) ?? { x: n.x, y: n.y },
        data: { ...n.data, selecionado: aberto === n.id, layout: layoutCard } satisfies FluxoNodePayload,
      }))
    })
  }, [dom, aberto, layoutCard, setNodes])

  // Tempo real: enquanto uma OP está aberta, re-busca o fluxo (números + linhas "andando") a cada 15s.
  useEffect(() => {
    if (!buscou) return
    const { pmo, op } = ctx.current
    const t = setInterval(async () => {
      const r = await carregarFluxo(pmo, op)
      if (r.ok) {
        setDom(r.nodes)
        setEdges(paraEdges(r.edges, r.nodes))
        setQtd(r.qtd)
        setAtualizadoMs(Date.now())
      }
    }, 15_000)
    return () => clearInterval(t)
  }, [buscou, sel])

  const detalhe = aberto ? dom.find((n) => n.id === aberto)?.data : undefined
  // Postos da OP em ordem (sem Manutenção nem as caixas Entrada/Saída) — pra timeline e % de progresso.
  const postosOP = useMemo(
    () => dom.filter((n) => n.id !== MANUTENCAO && n.id !== ENTRADA && n.id !== SAIDA).map((n) => n.id),
    [dom],
  )
  // Não iniciadas (fila do 1º posto): vêm do nó Entrada; mostradas no detalhe do 1º posto pra explicar o badge
  // (essas peças ainda não têm SN bipado, então não aparecem na lista "Pendentes no posto").
  const naoIniciadasPrimeiro = aberto && aberto === postosOP[0] ? (dom.find((n) => n.id === ENTRADA)?.data.wip ?? 0) : 0

  // Cabeçalho do Modo TV: PMO/OP + % de progresso do processo inteiro (sem o cliente).
  const opInfo = useMemo(() => {
    const [pmo, op] = sel.split('||')
    return { pmo: pmo ?? '', op: op ?? '' }
  }, [sel])
  // % "macro": soma das passagens (aprovadas p/ posto com status; registros p/ sem) de TODOS os postos
  // normais ÷ (qtd × nº de postos) — equivale à média do % de cada posto; exclui reprovados.
  const totalPassagens = useMemo(
    () => postosOP.reduce((acc, id) => {
      const d = dom.find((n) => n.id === id)?.data
      if (!d) return acc
      return acc + (d.temStatus ? d.aprovadas : d.registros)
    }, 0),
    [dom, postosOP],
  )
  const pctProcesso = qtd && qtd > 0 && postosOP.length > 0
    ? Math.round((totalPassagens / (qtd * postosOP.length)) * 100)
    : null

  // Modo TV: tela cheia do canvas (Fullscreen API) + re-encaixa o fluxo ao entrar/sair.
  const canvasRef = useRef<HTMLDivElement>(null)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const [telaCheia, setTelaCheia] = useState(false)
  const alternarTv = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void canvasRef.current?.requestFullscreen?.()
  }

  // Redefinir: descarta o layout salvo desta OP e volta os cards pra posição padrão do domínio.
  const redefinirLayout = useCallback(() => {
    const { pmo, op } = ctx.current
    if (pmo && op) { try { localStorage.removeItem(chaveLayout(pmo, op)) } catch { /* storage off */ } }
    layoutRef.current = new Map()
    setGuiaH(undefined)
    setGuiaV(undefined)
    setNodes((prev) => prev.map((n) => {
      const d = dom.find((x) => x.id === n.id)
      return d ? { ...n, position: { x: d.x, y: d.y } } : n
    }))
    setTimeout(() => rfRef.current?.fitView(), 0)
  }, [dom, setNodes])
  useEffect(() => {
    const onFs = () => {
      setTelaCheia(document.fullscreenElement === canvasRef.current)
      setTimeout(() => rfRef.current?.fitView(), 120)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Dropdown de OP: filtro por PMO/OP/cliente (a lista de OPs pode ser longa).
  const opsFiltradas = useMemo(() => {
    const f = filtroOp.trim().toLowerCase()
    if (!f) return ops
    return ops.filter((o) => `${o.pmo}/${o.op} ${o.cliente ?? ''}`.toLowerCase().includes(f))
  }, [ops, filtroOp])

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-1 flex-col gap-1.5 sm:max-w-md sm:min-w-64">
            <Label>OP</Label>
            <Select value={sel} onValueChange={(v) => escolher(v ?? '')} onOpenChange={(open) => { if (!open) setFiltroOp('') }}>
              <SelectTrigger><SelectValue placeholder="Selecione a OP" /></SelectTrigger>
              <SelectContent className="w-auto min-w-[22rem] max-w-[calc(100vw-2rem)]">
                {/* Filtro dentro do dropdown; não deixa o Select "sequestrar" as teclas (typeahead). */}
                <div className="sticky top-0 z-10 border-b border-border bg-popover p-1.5" onPointerDown={(e) => e.stopPropagation()}>
                  <input
                    value={filtroOp}
                    onChange={(e) => setFiltroOp(e.target.value)}
                    onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}
                    placeholder="Filtrar por PMO / OP / cliente…"
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>
                {opsFiltradas.length === 0 ? (
                  <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma OP encontrada.</p>
                ) : (
                  opsFiltradas.map((o) => (
                    <SelectItem key={`${o.pmo}||${o.op}`} value={`${o.pmo}||${o.op}`}>
                      {o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 pb-1">
            {buscou && atualizadoMs !== null && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Atualiza automaticamente a cada 15s">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                </span>
                Ao vivo · atualiza a cada 15s
              </span>
            )}
            {buscou && (
              // Toggle de layout do card — só p/ apresentação na reunião (comparar A × B).
              <div className="inline-flex overflow-hidden rounded-lg border border-border text-sm shadow-sm" role="group" aria-label="Layout do card">
                <button
                  type="button"
                  onClick={() => setLayoutCard('a')}
                  className={`px-3 py-1.5 font-medium ${layoutCard === 'a' ? 'bg-enterplak text-white' : 'bg-card hover:bg-accent'}`}
                >
                  Layout A
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutCard('b')}
                  className={`border-l border-border px-3 py-1.5 font-medium ${layoutCard === 'b' ? 'bg-enterplak text-white' : 'bg-card hover:bg-accent'}`}
                >
                  Layout B
                </button>
              </div>
            )}
            {buscou && (
              <Button variant="outline" size="sm" onClick={redefinirLayout} title="Volta os cards à posição padrão">
                <RotateCcw className="mr-1 size-4" /> Redefinir
              </Button>
            )}
            {buscou && (
              <Button variant="outline" size="sm" onClick={alternarTv}>
                <Maximize2 className="mr-1 size-4" /> Modo TV
              </Button>
            )}
          </div>
        </div>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {buscou && !carregando && nodes.length === 0 && (
          <p className="text-sm text-muted-foreground">Esta OP não tem postos no fluxo.</p>
        )}

        <div ref={canvasRef} className="fluxo-canvas relative h-[70vh] w-full overflow-hidden rounded-lg border border-border bg-neutral-100">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            nodesDraggable
            nodesConnectable={false}
            onInit={(inst) => { rfRef.current = inst }}
            onNodesChange={onNodesChangeGuia}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
          >
            <Background />
            <Controls showInteractive={false} />
            <HelperLines horizontal={guiaH} vertical={guiaV} />
          </ReactFlow>

          {telaCheia && (
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-6 border-b border-border bg-card/85 px-6 py-3 backdrop-blur">
              <div className="min-w-0">
                <p className="truncate text-2xl font-bold leading-tight">{opInfo.pmo}/{opInfo.op}</p>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-3xl font-bold leading-none text-enterplak tabular-nums">{pctProcesso !== null ? `${pctProcesso}%` : '—'}</p>
                  <p className="text-xs text-muted-foreground">progresso</p>
                </div>
                <button
                  type="button"
                  onClick={alternarTv}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent"
                >
                  <Minimize2 className="size-4" /> Sair (Esc)
                </button>
              </div>
            </div>
          )}

          {detalhe && (
            // Em Modo TV o cabeçalho (z-20) ocupa o topo; o aside desce pra baixo dele (senão o X fica coberto e não fecha).
            <aside className={`absolute right-0 z-30 flex w-80 max-w-[85%] flex-col border-l border-border bg-card/95 text-foreground shadow-lg backdrop-blur ${telaCheia ? 'top-16 h-[calc(100%-4rem)]' : 'top-0 h-full'}`}>
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
                        {naoIniciadasPrimeiro > 0 && (
                          <p className="mb-2 text-xs text-muted-foreground">
                            Inclui <span className="font-semibold text-foreground">{naoIniciadasPrimeiro}</span> não iniciada{naoIniciadasPrimeiro > 1 ? 's' : ''} (ainda sem bipe), na lista abaixo.
                          </p>
                        )}
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

        <HistoricoSnDialog
          sn={snAberto}
          postosOP={postosOP}
          onFechar={() => setSnAberto(null)}
          container={telaCheia ? canvasRef.current : undefined}
        />
      </CardContent>
    </Card>
  )
}
