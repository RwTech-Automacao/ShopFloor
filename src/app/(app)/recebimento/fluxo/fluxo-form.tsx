'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  Background,
  Panel,
  ReactFlow,
  useNodesState,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ChevronDown,
  ChevronsUpDown,
  Maximize2,
  Minimize2,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ControlesCanvas } from '@/shared/ui/fluxo/controles-canvas'
import { HelperLines, getHelperLines } from '@/shared/ui/fluxo/helper-lines'
import {
  carregarFluxoEmbAction,
  carregarHistoricoEtapaAction,
  carregarItensCaixaAction,
} from '@/modules/recebimento/application/fluxo-actions'
import {
  ehEtapa,
  formatarEspera,
  ROTULO_ETAPA,
  rotuloPassagem,
  temDivergencia,
  type Etapa,
} from '@/modules/recebimento/domain/etapa-processo'
import type { CaixaFluxo, ItemFluxo, PassagemEtapa } from '@/modules/recebimento/infra/fluxo-repository'
import { cn } from '@/lib/utils'
import { ArestaFluxo } from './aresta-fluxo'
import { FluxoRecebimentoNode, type FluxoRecebimentoNodeData } from './fluxo-node'

const ESPACO_X = 300 // folga entre as caixas (mesma do Fluxo do ShopFloor)
const ESPACO_Y = 200 // altura entre as duas linhas: o ramo do Reprovado desce da Qualidade

/** Arranjo padrão das quatro caixas: a cadeia na 1ª linha, o ramo embaixo da Qualidade. */
const POSICAO: Record<Etapa, { x: number; y: number }> = {
  recebimento: { x: 0, y: 0 },
  qualidade: { x: ESPACO_X, y: 0 },
  almoxarifado: { x: 2 * ESPACO_X, y: 0 },
  reprovado: { x: ESPACO_X, y: ESPACO_Y },
}

/** O que cada etapa é, em uma linha (o subtítulo do card). */
const SUBTITULO: Record<Etapa, string> = {
  recebimento: 'esperando conferência',
  qualidade: 'em conferência',
  almoxarifado: 'concluído',
  reprovado: 'ramo · fim de linha',
}

// Arranjo dos cards: cada EMB guarda o seu nesta máquina, como o Fluxo do ShopFloor faz por OP.
const chaveLayout = (emb: string) => `rec:fluxo:pos:${emb}`
function lerLayout(emb: string): Map<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(chaveLayout(emb))
    if (!raw) return new Map()
    return new Map(Object.entries(JSON.parse(raw) as Record<string, { x: number; y: number }>))
  } catch {
    return new Map()
  }
}

/** hh:mm dd/mm — data/hora compacta pros eventos do histórico. */
function fmtHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })
}

function numeroBr(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('pt-BR')
}

/** Item da lista: o código + o número do processo, que desempata o MESMO item duas vezes na EMB. */
function ItemRotulo({ item, numero }: { item: string; numero: number }) {
  return (
    <span className="truncate">
      {item || '—'}
      <span className="ml-1 text-muted-foreground">#{numero}</span>
    </span>
  )
}

/**
 * Itens que estão na etapa AGORA (acordeon, aberto por padrão): mostra os primeiros 100 e revela
 * +100 conforme rola. A fila já vem pronta do servidor (limitada), então a paginação é no cliente —
 * mesma UX do "Pendentes no posto" do Fluxo do ShopFloor.
 */
function ItensDaEtapa({
  itens,
  carregando,
  total,
}: {
  itens: ItemFluxo[]
  carregando: boolean
  /** Contagem da caixa: quando for maior que a lista, a consulta bateu no teto. */
  total: number
}) {
  const [aberto, setAberto] = useState(true)
  const [limite, setLimite] = useState(100)
  const visiveis = itens.slice(0, limite)
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span>Itens nesta etapa ({itens.length})</span>
        <ChevronDown className={`size-4 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div
          className="mt-1 max-h-72 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) setLimite((l) => l + 100)
          }}
        >
          {carregando ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {itens.length === 0 && <li className="text-muted-foreground">—</li>}
              {visiveis.map((i) => (
                <li key={i.processoId} className="flex justify-between gap-2 font-mono text-xs">
                  <ItemRotulo item={i.item} numero={i.numero} />
                  <span
                    className="shrink-0 text-muted-foreground"
                    title={`${i.descricao} · pedida ${numeroBr(i.quantidadePedido)} · recebida ${numeroBr(i.quantidadeRecebida)}`}
                  >
                    {temDivergencia(i.divergencia) && (
                      <span className="mr-1 text-amber-600" title={`Divergência de quantidade: ${i.divergencia}`}>
                        ⚠ {i.divergencia}
                      </span>
                    )}
                    {formatarEspera(i.segundos)}
                  </span>
                </li>
              ))}
              {itens.length > visiveis.length && (
                <li className="pt-1 text-center text-[11px] text-muted-foreground">
                  +{itens.length - visiveis.length} — role para carregar
                </li>
              )}
              {total > itens.length && (
                <li className="pt-1 text-center text-[11px] text-amber-600">
                  Mostrando os {itens.length} mais antigos de {total}.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Histórico da etapa (acordeon): fecha por padrão; ao abrir, carrega 100 do banco e vai buscando
 * +100 conforme rola (server-side, não puxa tudo). Uma linha por passagem, mais recente primeiro.
 * Mesmo comportamento do "Histórico do posto" do Fluxo do ShopFloor.
 */
function HistoricoDaEtapa({ emb, etapa }: { emb: string; etapa: Etapa }) {
  const [aberto, setAberto] = useState(false)
  const [linhas, setLinhas] = useState<PassagemEtapa[]>([])
  const [temMais, setTemMais] = useState(false)
  const [carregou, setCarregou] = useState(false)
  const [carregando, start] = useTransition()

  function alternar() {
    const novo = !aberto
    setAberto(novo)
    if (novo && !carregou) {
      start(async () => {
        const r = await carregarHistoricoEtapaAction(emb, etapa, 0)
        if (!r.ok) { toast.error(r.erro); return }
        setLinhas(r.linhas); setTemMais(r.temMais); setCarregou(true)
      })
    }
  }
  function mais() {
    if (carregando || !temMais) return
    start(async () => {
      const r = await carregarHistoricoEtapaAction(emb, etapa, linhas.length)
      if (!r.ok) { toast.error(r.erro); return }
      setLinhas((p) => [...p, ...r.linhas]); setTemMais(r.temMais)
    })
  }

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={alternar}
        className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span>Histórico da etapa{carregou ? ` (${linhas.length}${temMais ? '+' : ''})` : ''}</span>
        <ChevronDown className={`size-4 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div
          className="mt-1 max-h-72 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) mais()
          }}
        >
          {carregando && linhas.length === 0 ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {linhas.length === 0 && <li className="text-muted-foreground">—</li>}
              {linhas.map((l) => (
                <li key={l.id} className="flex justify-between gap-2 font-mono text-xs">
                  <ItemRotulo item={l.item} numero={l.numero} />
                  <span
                    className="shrink-0 text-muted-foreground"
                    title={`${l.passagem ? rotuloPassagem(l.passagem) : 'sem movimento'} · ${l.colaborador || 'sem colaborador'}`}
                  >
                    {l.passagem ? rotuloPassagem(l.passagem) : '—'} · {fmtHora(l.dataHora)}
                  </span>
                </li>
              ))}
              {temMais && (
                <li className="pt-1 text-center text-[11px] text-muted-foreground">
                  {carregando ? 'Carregando…' : 'Role para carregar mais'}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

const fmtRelogio = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
})

/** Hora atual no cabeçalho do Modo TV — num painel que fica horas ligado, "isto está vivo?" é a
 *  primeira pergunta. Igual ao do Fluxo do ShopFloor. */
function RelogioAoVivo() {
  const [hora, setHora] = useState(() => fmtRelogio.format(new Date()))
  useEffect(() => {
    const t = setInterval(() => setHora(fmtRelogio.format(new Date())), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="text-right">
      <p className="text-3xl font-bold leading-none tabular-nums text-foreground">{hora}</p>
      <p className="text-xs text-muted-foreground">agora</p>
    </div>
  )
}

export function FluxoForm({ embs }: { embs: string[] }) {
  const [emb, setEmb] = useState('')
  const [aberto, setAberto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [caixas, setCaixas] = useState<CaixaFluxo[] | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  const [etapaSel, setEtapaSel] = useState<Etapa | null>(null)
  const [itens, setItens] = useState<ItemFluxo[]>([])
  const [carregandoItens, setCarregandoItens] = useState(false)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [guiaH, setGuiaH] = useState<number | undefined>(undefined)
  const [guiaV, setGuiaV] = useState<number | undefined>(undefined)
  const layoutRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const embRef = useRef('') // EMB dos nós que estão no canvas agora

  const canvasRef = useRef<HTMLDivElement>(null)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [telaCheia, setTelaCheia] = useState(false)

  const embsFiltradas = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return f ? embs.filter((e) => e.toLowerCase().includes(f)) : embs
  }, [embs, filtro])

  const divergentes = useMemo(
    () => (caixas ?? []).reduce((soma, c) => soma + c.divergentes, 0),
    [caixas],
  )
  const total = useMemo(() => (caixas ?? []).reduce((soma, c) => soma + c.itens, 0), [caixas])
  // Progresso da EMB no Modo TV: itens que já saíram da conferência (Almoxarifado + Reprovado).
  const pctConcluido = useMemo(() => {
    if (!caixas || total === 0) return null
    const fim = (caixas.find((c) => c.etapa === 'almoxarifado')?.itens ?? 0)
      + (caixas.find((c) => c.etapa === 'reprovado')?.itens ?? 0)
    const raw = (fim / total) * 100
    return raw >= 100 ? '100' : (Math.floor(raw * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  }, [caixas, total])

  const nodeTypes = useMemo<NodeTypes>(() => ({ etapa: FluxoRecebimentoNode }), [])
  const edgeTypes = useMemo<EdgeTypes>(() => ({ fluxo: ArestaFluxo }), [])

  // Sincroniza os nós com os dados preservando a posição arrastada. Ao trocar de EMB, ignora as
  // posições atuais (senão o arranjo de uma EMB "vaza" pra outra) e usa o layout salvo daquela EMB.
  useEffect(() => {
    if (!caixas) { setNodes([]); return }
    const mesmaEmb = embRef.current === emb
    embRef.current = emb
    setNodes((prev) => {
      const posPorId = mesmaEmb
        ? new Map(prev.map((n) => [n.id, n.position]))
        : new Map<string, { x: number; y: number }>()
      return caixas.map((c) => ({
        id: c.etapa,
        type: 'etapa',
        // prioridade: posição arrastada na sessão → layout salvo da EMB → posição padrão.
        position: posPorId.get(c.etapa) ?? layoutRef.current.get(c.etapa) ?? POSICAO[c.etapa],
        data: {
          etapa: c.etapa,
          subtitulo: SUBTITULO[c.etapa],
          itens: c.itens,
          divergentes: c.divergentes,
          mediaSegundos: c.mediaSegundos,
          maiorSegundos: c.maiorSegundos,
          semTempo: c.semTempo,
          selecionado: etapaSel === c.etapa,
        } satisfies FluxoRecebimentoNodeData,
      }))
    })
  }, [caixas, emb, etapaSel, setNodes])

  const edges = useMemo<Edge[]>(() => {
    if (!caixas) return []
    const itensDe = (etapa: Etapa) => caixas.find((c) => c.etapa === etapa)?.itens ?? 0
    const cadeia = (source: Etapa, target: Etapa): Edge => ({
      id: `f:${source}->${target}`,
      source,
      target,
      type: 'fluxo',
      data: { ativo: itensDe(target) > 0 },
    })
    return [
      cadeia('recebimento', 'qualidade'),
      cadeia('qualidade', 'almoxarifado'),
      {
        // O ramo do Reprovado é desenhado como o ramo da Manutenção do ShopFloor (tracejado vinho).
        // A diferença é que dele não se volta.
        id: 'r:qualidade->reprovado',
        source: 'qualidade',
        target: 'reprovado',
        type: 'fluxo',
        data: { ramo: true },
      },
    ]
  }, [caixas])

  // Linhas-guia ao arrastar (o mesmo grude do Fluxo do ShopFloor).
  const onNodesChangeGuia = useCallback((changes: NodeChange<Node>[]) => {
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

  /** Salva o arranjo dos cards desta EMB no localStorage desta máquina. */
  const salvarLayout = useCallback(() => {
    const alvo = embRef.current
    if (!alvo) return
    setNodes((cur) => {
      const mapa: Record<string, { x: number; y: number }> = {}
      for (const n of cur) mapa[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
      layoutRef.current = new Map(Object.entries(mapa))
      try { localStorage.setItem(chaveLayout(alvo), JSON.stringify(mapa)) } catch { /* storage cheio/off */ }
      return cur
    })
  }, [setNodes])

  const onNodeDragStop = useCallback(() => {
    setGuiaH(undefined)
    setGuiaV(undefined)
    salvarLayout()
  }, [salvarLayout])

  /** Reorganizar: descarta o arranjo salvo desta EMB e volta os cards pra posição padrão. */
  const redefinirLayout = useCallback(() => {
    const alvo = embRef.current
    if (alvo) { try { localStorage.removeItem(chaveLayout(alvo)) } catch { /* storage off */ } }
    layoutRef.current = new Map()
    setGuiaH(undefined)
    setGuiaV(undefined)
    setNodes((prev) => prev.map((n) => (
      ehEtapa(n.id) ? { ...n, position: POSICAO[n.id] } : n
    )))
    setTimeout(() => rfRef.current?.fitView({ duration: 200 }), 0)
  }, [setNodes])

  // Modo TV: tela cheia do canvas (Fullscreen API) + re-encaixa o fluxo ao entrar/sair.
  const alternarTv = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void canvasRef.current?.requestFullscreen?.()
  }
  useEffect(() => {
    const onFs = () => {
      setTelaCheia(document.fullscreenElement === canvasRef.current)
      setTimeout(() => rfRef.current?.fitView({ duration: 200 }), 120)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  async function escolher(valor: string) {
    setEmb(valor)
    setAberto(false)
    setFiltro('')
    setEtapaSel(null)
    setItens([])
    setErro('')
    layoutRef.current = lerLayout(valor) // recupera o arranjo salvo desta EMB nesta máquina
    setCarregando(true)
    const r = await carregarFluxoEmbAction(valor)
    setCarregando(false)
    if (!r.ok) {
      setCaixas(null)
      setErro(r.erro)
      return
    }
    setCaixas(r.caixas)
    // Enquadra o fluxo da EMB nova depois do render (o canvas ainda não tem os nós neste tique).
    setTimeout(() => rfRef.current?.fitView({ duration: 200 }), 0)
  }

  async function abrirCaixa(etapa: Etapa) {
    // Clicar de novo na mesma caixa fecha o painel.
    if (etapaSel === etapa) {
      setEtapaSel(null)
      setItens([])
      return
    }
    setEtapaSel(etapa)
    setItens([])
    setCarregandoItens(true)
    const r = await carregarItensCaixaAction(emb, etapa)
    setCarregandoItens(false)
    if (!r.ok) {
      setErro(r.erro)
      return
    }
    setItens(r.itens)
  }

  const aoClicarNo: NodeMouseHandler = (_, node) => {
    if (ehEtapa(node.id)) void abrirCaixa(node.id)
  }

  const detalhe = etapaSel ? (caixas ?? []).find((c) => c.etapa === etapaSel) : undefined

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-1 flex-col gap-1.5 sm:max-w-md sm:min-w-64">
            <Label>EMB</Label>
            {/* Combobox (Popover + input), como o seletor de OP do Fluxo do ShopFloor: o Select
                sequestra as teclas e a lista de EMBs é longa. */}
            <Popover open={aberto} onOpenChange={(o) => { setAberto(o); if (!o) setFiltro('') }}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <span className={emb ? 'truncate' : 'truncate text-muted-foreground'}>
                      {emb || 'Selecione a EMB'}
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                  </button>
                }
              />
              <PopoverContent side="bottom" align="start" sideOffset={4} className="w-[22rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
                <div className="border-b border-border p-1.5">
                  <input
                    autoFocus
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                    placeholder="Filtrar EMB…"
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                  {embsFiltradas.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma EMB encontrada.</p>
                  ) : (
                    embsFiltradas.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => void escolher(e)}
                        className={cn(
                          'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                          emb === e && 'bg-accent font-medium',
                        )}
                      >
                        {e}
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-wrap items-center gap-3 pb-1">
            {caixas && (
              <Button
                variant="outline"
                size="sm"
                onClick={redefinirLayout}
                title="Volta os cards para a posição padrão e descarta o que foi arrastado nesta EMB"
              >
                <RotateCcw className="mr-1 size-4" /> Reorganizar
              </Button>
            )}
            {caixas && (
              <Button variant="outline" size="sm" onClick={alternarTv}>
                <Maximize2 className="mr-1 size-4" /> Modo TV
              </Button>
            )}
          </div>
        </div>

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        {caixas && (
          <>
            {/* Mesmo canvas do Fluxo do ShopFloor: `fluxo-canvas` é a classe compartilhada que
                esconde os pontos de conexão dos nós e deixa o canvas ocupar a tela no Modo TV. */}
            <div
              ref={canvasRef}
              className="fluxo-canvas relative h-[70vh] w-full overflow-hidden rounded-lg border border-border bg-neutral-100"
            >
              {carregando && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/40 backdrop-blur-sm">
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-6 py-4 shadow-lg">
                    <span className="size-5 animate-spin rounded-full border-2 border-enterplak border-t-transparent" />
                    <span className="text-base font-medium">Carregando fluxo…</span>
                  </div>
                </div>
              )}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                minZoom={0.1}
                maxZoom={4}
                nodesDraggable
                nodesConnectable={false}
                onInit={(inst) => { rfRef.current = inst; setZoomPct(Math.round(inst.getZoom() * 100)) }}
                onMove={(_, vp) => setZoomPct(Math.round(vp.zoom * 100))}
                onNodesChange={onNodesChangeGuia}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={aoClicarNo}
              >
                <Background />
                <Panel position="bottom-left">
                  <ControlesCanvas
                    pct={zoomPct}
                    onAplicar={(p) => rfRef.current?.zoomTo(p / 100, { duration: 200 })}
                    onMais={() => rfRef.current?.zoomIn({ duration: 200 })}
                    onMenos={() => rfRef.current?.zoomOut({ duration: 200 })}
                    onEnquadrar={() => rfRef.current?.fitView({ duration: 200 })}
                  />
                </Panel>
                <HelperLines horizontal={guiaH} vertical={guiaV} />
              </ReactFlow>

              {telaCheia && (
                <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-6 border-b border-border bg-card/85 px-6 py-3 backdrop-blur">
                  <div className="min-w-0">
                    <p className="truncate text-2xl font-bold leading-tight">EMB {emb}</p>
                    <p className="text-xs text-muted-foreground">
                      {total} {total === 1 ? 'item' : 'itens'}
                      {divergentes > 0 ? ` · ${divergentes} com divergência` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-6">
                    <RelogioAoVivo />
                    <div
                      className="text-right"
                      title="Itens que já saíram da conferência (Almoxarifado + Reprovado) ÷ itens da EMB"
                    >
                      <p className="text-3xl font-bold leading-none text-enterplak tabular-nums">
                        {pctConcluido !== null ? `${pctConcluido}%` : '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">concluído</p>
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

              {etapaSel && detalhe && (
                // Em Modo TV o cabeçalho (z-20) ocupa o topo; o aside desce pra baixo dele (senão o
                // X fica coberto e não fecha).
                <aside className={`absolute right-0 z-30 flex w-80 max-w-[85%] flex-col border-l border-border bg-card/95 text-foreground shadow-lg backdrop-blur ${telaCheia ? 'top-16 h-[calc(100%-4rem)]' : 'top-0 h-full'}`}>
                  <header className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{ROTULO_ETAPA[etapaSel]}</p>
                      <p className="text-xs text-muted-foreground">{SUBTITULO[etapaSel]}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setEtapaSel(null); setItens([]) }}
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Fechar"
                    >
                      <X className="size-4" />
                    </button>
                  </header>

                  <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
                    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Agora: <span className="font-bold">{detalhe.itens}</span></span>
                      <span className="text-muted-foreground">Médio: {formatarEspera(detalhe.mediaSegundos)}</span>
                      <span className="text-muted-foreground">Mais antigo: {formatarEspera(detalhe.maiorSegundos)}</span>
                      {detalhe.divergentes > 0 && (
                        <span className="text-amber-600">
                          <TriangleAlert className="mr-1 inline size-3.5" />
                          Divergência: {detalhe.divergentes}
                        </span>
                      )}
                      {detalhe.semTempo > 0 && (
                        <span className="text-muted-foreground" title="Itens sem histórico: aparecem na caixa do status, sem tempo">
                          Sem tempo: {detalhe.semTempo}
                        </span>
                      )}
                    </div>
                    <ItensDaEtapa itens={itens} carregando={carregandoItens} total={detalhe.itens} />
                    <HistoricoDaEtapa key={`${emb}:${etapaSel}`} emb={emb} etapa={etapaSel} />
                  </div>
                </aside>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? 'item' : 'itens'} na EMB {emb} ·{' '}
              {/* Divergência é contador à parte: é marca que viaja com o item, não caixa. */}
              <span className={divergentes > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : undefined}>
                {divergentes} {divergentes === 1 ? 'item' : 'itens'} com divergência
              </span>
            </p>
          </>
        )}

        {!caixas && carregando && (
          <p className="text-sm text-muted-foreground">Carregando o fluxo da EMB…</p>
        )}
      </CardContent>
    </Card>
  )
}
