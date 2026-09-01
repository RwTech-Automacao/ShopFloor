'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { ReactFlow, Background, Controls, useNodesState, type Node, type Edge, type NodeChange, type NodeTypes, type NodeMouseHandler, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X, Maximize2, Minimize2, RotateCcw, Search, SlidersHorizontal, Bug, MonitorPlay, ChevronLeft, ChevronRight, ChevronDown, Trash2, Plus, Play, ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { carregarFluxo, detalhePosto, snsManutencao, burninDetalhe, embalagemCaixas, historicoPosto, producaoPeriodo, rotaSn, fluxoPeriodo, type PeriodoContagem } from '@/modules/shopfloor/application/fluxo-actions'
import type { OpItem, SnDoPosto, BurninEmAndamento, BurninDetalhe, EmbalagemCaixa, PassagemDoPosto, ProducaoBucket } from '@/modules/shopfloor/infra/fluxo-repository'
import { MANUTENCAO, ENTRADA, SAIDA, type FluxoNodePos, type FluxoEdge, type PassagemPosto } from '@/modules/shopfloor/domain/fluxo-op'
import { formatarDuracao } from '@/modules/shopfloor/domain/burnin'
import { FluxoNode, type FluxoNodePayload } from './fluxo-node'
import { DefeitosLista } from './defeitos-lista'
import { DashboardForm } from '../analisar/dashboard/dashboard-form'
import type { OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'
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

// Turnos (definidos pelo usuário). "Dia" = matutino + vespertino somados (exclui o almoço).
const MATUTINO = { ini: '07:00', fim: '11:57' }
const VESPERTINO = { ini: '13:27', fim: '17:18' }
type Janela = 'dia' | 'matutino' | 'vespertino' | 'custom'

function hmParaMin(hm: string): number { const [h, m] = hm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0) }
/** Minutos úteis (matutino + vespertino de cada dia) entre dois instantes — base da cadência MACRO.
 *  Soma a interseção de [ini,fim] com as janelas de trabalho de cada dia (1º/último dia parciais). */
function minutosUteisEntre(iniMs: number, fimMs: number): number {
  if (!(fimMs > iniMs)) return 0
  const janelas = [[hmParaMin(MATUTINO.ini), hmParaMin(MATUTINO.fim)], [hmParaMin(VESPERTINO.ini), hmParaMin(VESPERTINO.fim)]]
  let total = 0
  const d = new Date(iniMs); d.setHours(0, 0, 0, 0)
  const ultimo = new Date(fimMs); ultimo.setHours(0, 0, 0, 0)
  for (let guard = 0; d.getTime() <= ultimo.getTime() && guard < 800; guard++) {
    const base = d.getTime()
    for (const [a, b] of janelas) {
      const s = Math.max(base + a! * 60000, iniMs)
      const e = Math.min(base + b! * 60000, fimMs)
      if (e > s) total += e - s
    }
    d.setDate(d.getDate() + 1)
  }
  return Math.round(total / 60000)
}

// Modo Apresentação: playlist de slides (OP + view), salva por máquina no localStorage.
type ViewSlide = 'fluxo' | 'defeitos' | 'dashboard'
interface Slide { pmo: string; op: string; cliente: string; view: ViewSlide }
const CHAVE_PLAYLIST = 'sf:fluxo:playlist'
const ROTULO_VIEW: Record<ViewSlide, string> = { fluxo: 'Fluxo', defeitos: 'Defeitos', dashboard: 'Dashboard' }
function lerPlaylist(): Slide[] {
  try { const raw = localStorage.getItem(CHAVE_PLAYLIST); return raw ? (JSON.parse(raw) as Slide[]) : [] } catch { return [] }
}
/** YYYY-MM-DD de um instante (ms) no fuso local (o navegador dos operadores é America/Sao_Paulo). */
function ymd(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** Rótulo curto do filtro ativo pro botão (ex.: "Hoje · Matutino"). */
function rotuloJanela(j: Janela, c: { ini: string; fim: string }): string {
  if (j === 'matutino') return 'Matutino'
  if (j === 'vespertino') return 'Vespertino'
  if (j === 'custom') return `${c.ini}–${c.fim}`
  return 'Dia'
}
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
    return { id: e.id, source: e.source, target: e.target, type: 'floating', data: { ativo, concluido, reprova } }
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
function ListaSns({ titulo, itens, carregando, onSn, limite = Infinity }: { titulo: string; itens: SnDoPosto[]; carregando: boolean; onSn: (sn: string) => void; limite?: number }) {
  const visiveis = itens.slice(0, limite)
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo} ({itens.length})</p>
      {carregando ? (
        <p className="text-muted-foreground">Carregando…</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {itens.length === 0 && <li className="text-muted-foreground">—</li>}
          {visiveis.map((s, i) => (
            <li key={`${s.sn}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
              <SnBotao sn={s.sn} onSn={onSn} />
              <span className="text-muted-foreground">{s.status || '—'}{s.vezes > 1 ? ` ×${s.vezes}` : ''}</span>
            </li>
          ))}
          {itens.length > visiveis.length && (
            <li className="pt-1 text-center text-[11px] text-muted-foreground">+{itens.length - visiveis.length} — role para carregar</li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Histórico do posto (acordeon): fecha por padrão; ao abrir, carrega 100 do banco e vai buscando
 *  +100 conforme rola (server-side, não puxa tudo). Uma linha por passagem, mais recente primeiro. */
function HistoricoPosto({ pmo, op, posto, onSn }: { pmo: string; op: string; posto: string; onSn: (sn: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [linhas, setLinhas] = useState<PassagemDoPosto[]>([])
  const [temMais, setTemMais] = useState(false)
  const [carregou, setCarregou] = useState(false)
  const [carregando, start] = useTransition()

  function alternar() {
    const novo = !aberto
    setAberto(novo)
    if (novo && !carregou) {
      start(async () => {
        const r = await historicoPosto(pmo, op, posto, 0)
        if (!r.ok) { toast.error(r.erro); return }
        setLinhas(r.linhas); setTemMais(r.temMais); setCarregou(true)
      })
    }
  }
  function mais() {
    if (carregando || !temMais) return
    start(async () => {
      const r = await historicoPosto(pmo, op, posto, linhas.length)
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
        <span>Histórico do posto{carregou ? ` (${linhas.length}${temMais ? '+' : ''})` : ''}</span>
        <ChevronDown className={`size-4 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div
          className="mt-1 max-h-72 overflow-y-auto"
          onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) mais() }}
        >
          {carregando && linhas.length === 0 ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {linhas.length === 0 && <li className="text-muted-foreground">—</li>}
              {linhas.map((p, i) => (
                <li key={`${p.sn}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
                  <SnBotao sn={p.sn} onSn={onSn} />
                  <span className="text-muted-foreground">{p.status || '—'} · {fmtHora(p.dataHora)}</span>
                </li>
              ))}
              {temMais && (
                <li className="pt-1 text-center text-[11px] text-muted-foreground">{carregando ? 'Carregando…' : 'Role para carregar mais'}</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Pendentes no posto (acordeon): mostra os primeiros 100 e revela +100 conforme rola. A fila já vem
 *  pronta do servidor (limitada), então a paginação aqui é no cliente — mesma UX do Histórico. */
function PendentesPosto({ titulo, itens, carregando, onSn, defaultOpen }: { titulo: string; itens: SnDoPosto[]; carregando: boolean; onSn: (sn: string) => void; defaultOpen?: boolean }) {
  const [aberto, setAberto] = useState(defaultOpen ?? true)
  const [limite, setLimite] = useState(100)
  const visiveis = itens.slice(0, limite)
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <span>{titulo} ({itens.length})</span>
        <ChevronDown className={`size-4 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div
          className="mt-1 max-h-72 overflow-y-auto"
          onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) setLimite((l) => l + 100) }}
        >
          {carregando ? (
            <p className="text-muted-foreground">Carregando…</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {itens.length === 0 && <li className="text-muted-foreground">—</li>}
              {visiveis.map((s, i) => (
                <li key={`${s.sn}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
                  <SnBotao sn={s.sn} onSn={onSn} />
                  <span className="text-muted-foreground">{s.status || '—'}{s.vezes > 1 ? ` ×${s.vezes}` : ''}</span>
                </li>
              ))}
              {itens.length > visiveis.length && (
                <li className="pt-1 text-center text-[11px] text-muted-foreground">+{itens.length - visiveis.length} — role para carregar</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Arredonda pra cima pra um "topo" bonito de eixo (1/2/5 × 10^n). */
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const passo = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return passo * p
}

/** Gráfico de produção do posto por período (peças × dia/hora) — LINHA + área, com grade e eixos.
 *  Carrega ao abrir o posto; segue o filtro (janela por hora) ou o macro (por dia, desde o início ali). */
function GraficoProducao({ pmo, op, posto, ini, fim, bucket }: { pmo: string; op: string; posto: string; ini: string | null; fim: string | null; bucket: 'dia' | 'hora' }) {
  const [dados, setDados] = useState<ProducaoBucket[]>([])
  const [carregou, setCarregou] = useState(false)
  const [carregando, start] = useTransition()
  const boxRef = useRef<HTMLDivElement>(null)
  const [larg, setLarg] = useState(600) // largura medida (pra o SVG 1:1 não distorcer texto/linha)
  const [hover, setHover] = useState<number | null>(null) // índice do ponto sob o mouse (tooltip)
  useEffect(() => {
    if (!pmo || !op || !posto) return
    let vivo = true
    setCarregou(false) // eslint-disable-line react-hooks/set-state-in-effect
    start(async () => {
      const r = await producaoPeriodo(pmo, op, posto, ini, fim, bucket)
      if (!vivo) return
      if (r.ok) { setDados(r.linhas); setCarregou(true) }
    })
    return () => { vivo = false }
  }, [pmo, op, posto, ini, fim, bucket])
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => { for (const e of es) setLarg(Math.max(240, Math.round(e.contentRect.width))) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const total = dados.reduce((s, d) => s + d.qtd, 0)
  // Geometria do chart (coords 1:1 = pixels reais → texto/linha sem distorção).
  const H = 168, padL = 40, padR = 10, padT = 12, padB = 24
  const W = larg
  const plotW = Math.max(1, W - padL - padR)
  const plotH = H - padT - padB
  const maxV = niceCeil(dados.reduce((m, d) => Math.max(m, d.qtd), 0))
  const n = dados.length
  const px = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW)
  const py = (v: number) => padT + plotH * (1 - v / maxV)
  const linePts = dados.map((d, i) => `${px(i)},${py(d.qtd)}`).join(' ')
  const areaPath = n > 1
    ? `M ${px(0)},${padT + plotH} ` + dados.map((d, i) => `L ${px(i)},${py(d.qtd)}`).join(' ') + ` L ${px(n - 1)},${padT + plotH} Z`
    : ''
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxV * f))
  const labelStep = Math.max(1, Math.ceil(n / 6))

  return (
    <div className="mb-1" ref={boxRef}>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Produção por {bucket === 'hora' ? 'hora' : 'dia'}{carregou ? ` · ${total} total` : ''}
      </p>
      {carregando && !carregou ? (
        <p className="text-xs text-muted-foreground" style={{ height: H }}>Carregando…</p>
      ) : dados.length === 0 ? (
        <p className="text-xs text-muted-foreground" style={{ height: H }}>Sem produção no período.</p>
      ) : (
        <div className="relative">
          <svg
            width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = e.clientX - rect.left
              if (n <= 1) { setHover(0); return }
              const i = Math.max(0, Math.min(n - 1, Math.round(((mx - padL) / plotW) * (n - 1))))
              setHover(i)
            }}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t, i) => {
              const y = py(t)
              return (
                <g key={i}>
                  <line x1={padL} y1={y} x2={W - padR} y2={y} className="stroke-border" strokeWidth={1} />
                  <text x={padL - 6} y={y} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>{t}</text>
                </g>
              )
            })}
            {areaPath && <path d={areaPath} className="fill-enterplak/10" />}
            {n > 1 && <polyline points={linePts} fill="none" className="stroke-enterplak" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {n === 1 && <circle cx={px(0)} cy={py(dados[0]!.qtd)} r={3.5} className="fill-enterplak" />}
            {dados.map((d, i) => ((i % labelStep === 0 || i === n - 1) ? (
              <text key={i} x={px(i)} y={H - 7} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>{d.rotulo}</text>
            ) : null))}
            {/* Guia + ponto sob o mouse */}
            {hover !== null && dados[hover] && (
              <g>
                <line x1={px(hover)} y1={padT} x2={px(hover)} y2={padT + plotH} className="stroke-muted-foreground/50" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={px(hover)} cy={py(dados[hover]!.qtd)} r={4} className="fill-enterplak stroke-card" strokeWidth={2} />
              </g>
            )}
          </svg>
          {/* Tooltip "mais informações" */}
          {hover !== null && dados[hover] && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-md"
              style={{ left: Math.min(Math.max(px(hover), 56), W - 56), top: 2 }}
            >
              <div className="font-semibold text-foreground">{dados[hover]!.rotulo}</div>
              <div className="text-muted-foreground">{dados[hover]!.qtd} peças</div>
            </div>
          )}
        </div>
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
function ListaSimples({ titulo, itens, onSn, limite = Infinity }: { titulo: string; itens: { sn: string; dir: string }[]; onSn: (sn: string) => void; limite?: number }) {
  const visiveis = itens.slice(0, limite)
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo} ({itens.length})</p>
      <ul className="flex flex-col gap-0.5">
        {itens.length === 0 && <li className="text-muted-foreground">—</li>}
        {visiveis.map((e, i) => (
          <li key={`${e.sn}-${i}`} className="flex justify-between gap-2 font-mono text-xs">
            <SnBotao sn={e.sn} onSn={onSn} />
            <span className="text-muted-foreground">{e.dir}</span>
          </li>
        ))}
        {itens.length > visiveis.length && (
          <li className="pt-1 text-center text-[11px] text-muted-foreground">+{itens.length - visiveis.length} — role para carregar</li>
        )}
      </ul>
    </div>
  )
}

export function FluxoForm({ ops, ordensDashboard }: { ops: OpItem[]; ordensDashboard: OrdemPesquisa[] }) {
  const [sel, setSel] = useState('')
  const [dom, setDom] = useState<FluxoNodePos[]>([])
  const [edgesBase, setEdgesBase] = useState<Edge[]>([])
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
  const nodesOpRef = useRef('') // a que OP (sel) os `nodes` atuais pertencem — evita vazar posição entre OPs
  const [guiaH, setGuiaH] = useState<number | undefined>(undefined) // linha-guia horizontal ao arrastar
  const [guiaV, setGuiaV] = useState<number | undefined>(undefined) // linha-guia vertical ao arrastar
  const [atualizadoMs, setAtualizadoMs] = useState<number | null>(null) // tempo real: quando atualizou por último
  const [qtd, setQtd] = useState<number | null>(null) // qtd da OP (pro % de progresso no Modo TV)
  const [filtroOp, setFiltroOp] = useState('') // busca do dropdown de OP
  const [opAberto, setOpAberto] = useState(false) // combobox de OP aberto
  const opFiltroRef = useRef<HTMLInputElement>(null) // foco no input do combobox ao abrir
  const [filtroData, setFiltroData] = useState<'tudo' | 'hoje' | '7' | '30' | 'custom'>('tudo') // filtro por data de criação da OP
  const [criadoDe, setCriadoDe] = useState('') // range custom (criação) — início (YYYY-MM-DD)
  const [criadoAte, setCriadoAte] = useState('') // range custom (criação) — fim (YYYY-MM-DD)
  const [buscaSn, setBuscaSn] = useState('') // busca de SN pra realçar a rota no canvas
  // rota do SN buscado: `ordem` = postos na ordem cronológica (+ atual no fim) pra revelar UM A UM.
  const [rota, setRota] = useState<{ ordem: string[]; atual: string | null } | null>(null)
  const [rotaPasso, setRotaPasso] = useState(0) // quantos cards da rota já foram revelados (preenche 1 a cada 0,30s)
  const [, startRota] = useTransition()
  const [defeitosAberto, setDefeitosAberto] = useState(false) // painel de Defeitos da OP (dentro do Fluxo)
  // Modo Apresentação (playlist de slides OP+view em tela cheia).
  const [playlist, setPlaylist] = useState<Slide[]>([])
  const [apresPainel, setApresPainel] = useState(false) // painel pra montar a playlist
  const [apresentando, setApresentando] = useState(false)
  const [slideIdx, setSlideIdx] = useState(0)
  const [tempoSlide, setTempoSlide] = useState(15) // segundos por slide
  const [addOp, setAddOp] = useState('') // OP escolhida no builder (pmo||op)
  const [addView, setAddView] = useState<ViewSlide>('fluxo')
  const [filtroAddOp, setFiltroAddOp] = useState('') // filtro do dropdown de OP do builder
  // Onda 3 — filtro de período + cadência (modal).
  const [filtroAberto, setFiltroAberto] = useState(false)
  const [dataFiltro, setDataFiltro] = useState('') // YYYY-MM-DD; vazio = hoje (derivado de agoraMs)
  const [janela, setJanela] = useState<Janela>('dia')
  const [custom, setCustom] = useState({ ini: '07:00', fim: '11:57' })
  const [producaoTotal, setProducaoTotal] = useState(false) // contagens do card: total (on) vs período (off)
  const [periodo, setPeriodo] = useState<Record<string, PeriodoContagem> | null>(null)
  const [periodoChave, setPeriodoChave] = useState('') // chave da janela a que o `periodo` carregado pertence
  // Filtro EXPLÍCITO aplicado? Não = visão MACRO (produção total + gráfico por dia desde o início do posto).
  // Sim = janela/dia escolhidos (produção do período + gráfico por hora). "Limpar filtro" volta pro macro.
  const [filtroAplicado, setFiltroAplicado] = useState(false)
  const faixasRef = useRef<{ ini: string; fim: string }[]>([]) // faixas atuais (pro refresh de 15s)
  const filtroAplicadoRef = useRef(false) // pro refresh saber se recarrega o período (ou fica no macro)
  const [limite, setLimite] = useState(100) // lazy load do painel de detalhe: quantos itens mostrar por lista

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
    setLimite(100) // novo posto → lazy load recomeça do topo
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
    setRota(null); setBuscaSn('') // troca de OP zera o realce de rota
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    ctx.current = { pmo, op }
    layoutRef.current = lerLayout(pmo, op) // recupera o arranjo salvo desta OP nesta máquina
    startCarregar(async () => {
      const r = await carregarFluxo(pmo, op)
      if (!r.ok) { toast.error(r.erro); return }
      setDom(r.nodes)
      setEdgesBase(paraEdges(r.edges, r.nodes))
      setQtd(r.qtd)
      setAtualizadoMs(Date.now())
      setBuscou(true)
    })
  }, [])

  // ===== Modo Apresentação (playlist) =====
  // Carrega a playlist salva (localStorage) no mount; salva a cada mudança.
  useEffect(() => {
    const p = lerPlaylist()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync único do localStorage no mount
    if (p.length) setPlaylist(p)
  }, [])
  useEffect(() => { try { localStorage.setItem(CHAVE_PLAYLIST, JSON.stringify(playlist)) } catch { /* storage off */ } }, [playlist])

  const adicionarSlide = (view: ViewSlide) => {
    const o = ops.find((x) => `${x.pmo}||${x.op}` === addOp)
    if (!o) { toast.error('Escolha uma OP.'); return }
    setPlaylist((p) => [...p, { pmo: o.pmo, op: o.op, cliente: o.cliente, view }])
  }
  const adicionarTodasViews = () => {
    const o = ops.find((x) => `${x.pmo}||${x.op}` === addOp)
    if (!o) { toast.error('Escolha uma OP.'); return }
    setPlaylist((p) => [...p, ...(['fluxo', 'defeitos', 'dashboard'] as ViewSlide[]).map((view) => ({ pmo: o.pmo, op: o.op, cliente: o.cliente, view }))])
  }
  const removerSlide = (i: number) => setPlaylist((p) => p.filter((_, idx) => idx !== i))
  const moverSlide = (i: number, delta: number) => setPlaylist((p) => {
    const j = i + delta
    if (j < 0 || j >= p.length) return p
    const c = [...p]; const [s] = c.splice(i, 1); c.splice(j, 0, s!); return c
  })

  const iniciarApresentacao = () => {
    if (playlist.length === 0) { toast.error('Monte a playlist antes de apresentar.'); return }
    setApresPainel(false); setSlideIdx(0); setApresentando(true)
    void canvasRef.current?.requestFullscreen?.() // tela cheia (Esc sai)
  }
  const sairApresentacao = () => { setApresentando(false); if (document.fullscreenElement) void document.exitFullscreen() }
  const slideAtual = apresentando ? playlist[slideIdx] : undefined

  // Slide de FLUXO → carrega a OP no canvas (defeitos/dashboard usam overlay, não precisam do canvas).
  useEffect(() => {
    if (!apresentando || !slideAtual || slideAtual.view !== 'fluxo') return
    const v = `${slideAtual.pmo}||${slideAtual.op}`
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega a OP do slide (sync ao trocar de slide)
    if (v !== sel) escolher(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda ao trocar de slide/entrar na apresentação
  }, [apresentando, slideIdx])

  // Auto-avança (tempo do slide) + setas ←/→ + Esc pra sair.
  useEffect(() => {
    if (!apresentando || playlist.length === 0) return
    const t = setInterval(() => setSlideIdx((i) => (i + 1) % playlist.length), Math.max(3, tempoSlide) * 1000)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setSlideIdx((i) => (i + 1) % playlist.length)
      else if (e.key === 'ArrowLeft') setSlideIdx((i) => (i - 1 + playlist.length) % playlist.length)
      else if (e.key === 'Escape') sairApresentacao()
    }
    document.addEventListener('keydown', onKey)
    return () => { clearInterval(t); document.removeEventListener('keydown', onKey) }
  }, [apresentando, playlist.length, tempoSlide])

  // OP selecionada (pra levar PMO + descrição à caixa de Entrada). `sel` = "pmo||op".
  const opSel = useMemo(() => ops.find((o) => `${o.pmo}||${o.op}` === sel) ?? null, [ops, sel])

  // ===== Onda 3: período + cadência =====
  const dataEfetiva = dataFiltro || ymd(agoraMs) // vazio → hoje (derivado de agoraMs = render-puro)
  // Chave da janela atual: usada pra só mostrar a cadência quando a produção carregada FOR desta janela
  // (senão, na transição matutino→vespertino, os minutos novos dividem os registros velhos → tempo errado).
  const chaveJanela = `${dataEfetiva}|${janela}|${custom.ini}|${custom.fim}`
  // Faixas [ini,fim) da janela escolhida, como ISO (instante local do navegador = America/Sao_Paulo).
  const faixas = useMemo<{ ini: string; fim: string }[]>(() => {
    const mk = (t: string) => new Date(`${dataEfetiva}T${t}:00`).toISOString()
    const range = (r: { ini: string; fim: string }) => ({ ini: mk(r.ini), fim: mk(r.fim) })
    if (janela === 'matutino') return [range(MATUTINO)]
    if (janela === 'vespertino') return [range(VESPERTINO)]
    if (janela === 'custom') return [range(custom)]
    return [range(MATUTINO), range(VESPERTINO)] // dia = matutino + vespertino
  }, [dataEfetiva, janela, custom])
  useEffect(() => { faixasRef.current = faixas }, [faixas]) // pro refresh de 15s ler as faixas atuais
  useEffect(() => { filtroAplicadoRef.current = filtroAplicado }, [filtroAplicado])
  // Minutos efetivos da janela (soma das faixas), capando o fim em "agora" (turno em andamento hoje).
  const minutosEfetivos = useMemo(() => {
    let tot = 0
    for (const f of faixas) tot += Math.max(0, Math.min(Date.parse(f.fim), agoraMs) - Date.parse(f.ini))
    return Math.round(tot / 60000)
  }, [faixas, agoraMs])
  // Cadência (segundos/peça) por posto = minutos_efetivos × 60 ÷ registros no período.
  const cadenciaSeg = useMemo(() => {
    const out: Record<string, number> = {}
    if (filtroAplicado) {
      // Cadência da JANELA — só quando a produção carregada é DESTA janela (evita minutos-novos ÷ registros-velhos).
      if (!periodo || periodoChave !== chaveJanela || minutosEfetivos <= 0) return out
      for (const [posto, c] of Object.entries(periodo)) {
        if (c.registros > 0) out[posto] = Math.round((minutosEfetivos * 60) / c.registros)
      }
      return out
    }
    // Cadência MACRO (sem filtro): minutos úteis do 1º ao último registro do posto ÷ registros (todas as peças).
    for (const n of dom) {
      const d = n.data
      if (d.ehManutencao || d.ehEntrada || d.ehSaida || !d.primeiroEm || !d.ultimoEm || d.registros <= 0) continue
      const min = minutosUteisEntre(Date.parse(d.primeiroEm), Math.min(Date.parse(d.ultimoEm), agoraMs))
      if (min > 0) out[n.id] = Math.round((min * 60) / d.registros)
    }
    return out
  }, [filtroAplicado, periodo, periodoChave, chaveJanela, minutosEfetivos, dom, agoraMs])
  // Busca a produção do período (soma das faixas) ao trocar OP/filtro.
  useEffect(() => {
    // Só carrega o período quando o filtro está APLICADO; senão é visão macro (produção total).
    if (!buscou || !filtroAplicado) { setPeriodo(null); return } // eslint-disable-line react-hooks/set-state-in-effect
    const { pmo, op } = ctx.current
    if (!pmo || !op) return
    let vivo = true
    fluxoPeriodo(pmo, op, faixas).then((r) => { if (vivo && r.ok) { setPeriodo(r.postos); setPeriodoChave(chaveJanela) } }).catch(() => {})
    return () => { vivo = false }
  }, [buscou, filtroAplicado, sel, faixas, chaveJanela])

  // Busca de SN: realça a rota da peça no canvas (estilo n8n). `realce` = nós a acender; `atual` = posição.
  const buscarRota = () => {
    const sn = buscaSn.trim()
    const { pmo, op } = ctx.current
    if (!sn) { setRota(null); return } // Ver sem SN → volta o fluxo normal/total
    if (!pmo || !op) return
    startRota(async () => {
      const r = await rotaSn(pmo, op, sn)
      if (!r.ok) { toast.error(r.erro); return }
      if (r.postos.length === 0) { toast.error('Este SN não passou por esta OP.'); setRota(null); return }
      // Concluiu (r.atual null) → destaca a caixa "Concluído" (SAÍDA) SE ela existe (OP com qtd);
      // OP sem qtd não tem esse nó → posição atual = último posto visitado (senão o realce cairia no vácuo).
      const temSaida = dom.some((n) => n.id === SAIDA)
      const atual = r.atual ?? (temSaida ? SAIDA : (r.postos[r.postos.length - 1] ?? null))
      const ordem = [...r.postos]
      if (atual && !ordem.includes(atual)) ordem.push(atual) // posição atual entra no fim da ordem de revelação
      setRota({ ordem, atual })
    })
  }
  const limparRota = () => { setRota(null); setBuscaSn('') }

  // Revela a rota do SN card a card, na ordem, 1 a cada 0,30s (preenchimento estilo n8n).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza a animação da rota (limpa/inicia)
    if (!rota) { setRotaPasso(0); return }
    setRotaPasso(1)
    // Elementos intercalados: nó0, aresta0, nó1, aresta1, … → 2N−1 passos (card, aresta, card, aresta…).
    const total = rota.ordem.length * 2 - 1
    if (total <= 1) return
    let i = 1
    // 950ms ≈ duração da animação (0,9s) → cada card/aresta COMPLETA antes do próximo começar.
    const id = setInterval(() => { i++; setRotaPasso(i); if (i >= total) clearInterval(id) }, 950)
    return () => clearInterval(id)
  }, [rota])

  // Arestas do canvas: rótulo = CADÊNCIA do posto de ORIGEM (segundos/peça); + overlay da rota do SN.
  // Rota revela intercalado (card, aresta, card…): aresta ordem[i]→ordem[i+1] = elemento 2i+1.
  const edges = useMemo<Edge[]>(() => {
    return edgesBase.map((e) => {
      const base = { ...((e.data ?? {}) as object), cadencia: cadenciaSeg[e.source] }
      if (!rota) return { ...e, data: base }
      const i = rota.ordem.indexOf(e.source)
      const trechoDaRota = i >= 0 && rota.ordem[i + 1] === e.target // aresta é um trecho consecutivo da rota?
      const elem = 2 * i + 1 // aresta = elemento ímpar na sequência intercalada
      const revelado = trechoDaRota && elem < rotaPasso
      const animando = trechoDaRota && elem === rotaPasso - 1 // só a recém-revelada anima; as demais ficam fixas
      return { ...e, data: { ...base, emRota: revelado, animarRota: animando, atenuado: !revelado } }
    })
  }, [edgesBase, rota, rotaPasso, cadenciaSeg])

  // Sincroniza os nós com o domínio (badges/estado) preservando a posição arrastada pelo usuário.
  useEffect(() => {
    // O id do nó é o NOME do posto (compartilhado entre OPs). Só preserva a posição de `prev`
    // quando os nós são da MESMA OP; ao trocar de OP, ignora `prev` (senão a posição arrastada de
    // uma OP "vaza" pra outra) e usa o layout salvo daquela OP / posição padrão do domínio.
    const mesmaOp = nodesOpRef.current === sel
    nodesOpRef.current = sel
    setNodes((prev) => {
      const posById = mesmaOp ? new Map(prev.map((n) => [n.id, n.position])) : new Map<string, { x: number; y: number }>()
      return dom.map((n) => ({
        id: n.id,
        type: 'fluxo',
        // prioridade: posição arrastada na sessão → layout salvo da OP → posição padrão do domínio.
        position: posById.get(n.id) ?? layoutRef.current.get(n.id) ?? { x: n.x, y: n.y },
        data: {
          ...n.data,
          selecionado: aberto === n.id,
          // Só a Entrada carrega PMO/OP + descrição da OP (o card mostra; o domínio não tem esse dado).
          ...(n.id === ENTRADA ? { pmo: opSel?.pmo, op: opSel?.op, descricao: opSel?.descricao } : {}),
          // Busca de SN: realce da rota (vinho, preenchendo card a card por `rotaPasso`). Sem rota → undefined.
          ...(rota ? (() => {
            const idx = rota.ordem.indexOf(n.id)
            const revelado = idx >= 0 && (2 * idx) < rotaPasso // nó = elemento 2*idx (intercalado com as arestas)
            const animando = idx >= 0 && (2 * idx) === rotaPasso - 1 // só o card recém-revelado faz o giro
            return { emRota: revelado && n.id !== rota.atual, atualRota: revelado && n.id === rota.atual, foraRota: !revelado, animarRota: animando }
          })() : {}),
          // Onda 3: contagens do período no card (a menos que "Produção total" esteja ligado).
          ...(periodo && !producaoTotal ? { mostrarPeriodo: true, periodoAprovadas: periodo[n.id]?.aprovadas ?? 0, periodoReprovadas: periodo[n.id]?.reprovadas ?? 0, periodoRegistros: periodo[n.id]?.registros ?? 0 } : {}),
        } satisfies FluxoNodePayload,
      }))
    })
  }, [dom, aberto, opSel, sel, rota, rotaPasso, periodo, producaoTotal, setNodes])

  // Tempo real: enquanto uma OP está aberta, re-busca o fluxo (números + linhas "andando") a cada 20s.
  // PERF: pula o tick quando a aba não está visível (Page Visibility) — evita que abas de Fluxo em 2º
  // plano fiquem martelando o RDS. Ao voltar pra aba, atualiza na hora (evento visibilitychange).
  useEffect(() => {
    if (!buscou) return
    const { pmo, op } = ctx.current
    let vivo = true
    const atualizar = async () => {
      const r = await carregarFluxo(pmo, op)
      if (vivo && r.ok) {
        setDom(r.nodes)
        setEdgesBase(paraEdges(r.edges, r.nodes))
        setQtd(r.qtd)
        setAtualizadoMs(Date.now())
      }
      if (filtroAplicadoRef.current) { // só recarrega o período quando o filtro está aplicado (senão macro)
        const rp = await fluxoPeriodo(pmo, op, faixasRef.current) // produção do período + cadência
        if (vivo && rp.ok) setPeriodo(rp.postos)
      }
    }
    const t = setInterval(() => { if (!document.hidden) void atualizar() }, 20_000)
    const onVis = () => { if (!document.hidden) void atualizar() } // voltou pra aba → atualiza já
    document.addEventListener('visibilitychange', onVis)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [buscou, sel])

  const detalhe = aberto ? dom.find((n) => n.id === aberto)?.data : undefined
  // Postos da OP em ordem (sem Manutenção nem as caixas Entrada/Saída) — pra timeline e % de progresso.
  const postosOP = useMemo(
    () => dom.filter((n) => n.id !== MANUTENCAO && n.id !== ENTRADA && n.id !== SAIDA).map((n) => n.id),
    [dom],
  )
  // Range do gráfico de produção: filtro aplicado → a janela do filtro (por hora); senão macro (por dia).
  const graficoRange = useMemo<{ ini: string | null; fim: string | null; bucket: 'dia' | 'hora' }>(() => {
    if (filtroAplicado && faixas.length > 0) {
      return { ini: faixas[0]!.ini, fim: faixas[faixas.length - 1]!.fim, bucket: 'hora' }
    }
    return { ini: null, fim: null, bucket: 'dia' }
  }, [filtroAplicado, faixas])

  // posto → recurso/temStatus (pro ícone do posto na tela de Defeitos).
  const postoInfoMap = useMemo(() => {
    const m: Record<string, { recurso: string; temStatus: boolean }> = {}
    for (const n of dom) m[n.id] = { recurso: n.data.recurso, temStatus: n.data.temStatus }
    return m
  }, [dom])

  // Navegação por setas Fluxo ↔ Defeitos (→ abre Defeitos, ← volta pro Fluxo). Fora da apresentação
  // (que usa as setas pros slides) e ignorando quando o foco está num campo de texto ou num diálogo.
  useEffect(() => {
    if (apresentando) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (!buscou || opAberto || snAberto) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      setDefeitosAberto(e.key === 'ArrowRight')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apresentando, buscou, opAberto, snAberto])
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
  const [containerTv, setContainerTv] = useState<HTMLElement | null>(null) // alvo do portal do diálogo no Modo TV
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
      const emTv = document.fullscreenElement === canvasRef.current
      setTelaCheia(emTv)
      setContainerTv(emTv ? canvasRef.current : null) // captura o alvo do portal fora do render (regra dos refs)
      if (!emTv) setApresentando(false) // saiu da tela cheia (Esc/botão) → encerra a apresentação
      setTimeout(() => rfRef.current?.fitView(), 120)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Dropdown de OP: filtro por PMO/OP/cliente (texto) + por data de CRIAÇÃO da OP (a lista pode ser longa).
  const opsFiltradas = useMemo(() => {
    const f = filtroOp.trim().toLowerCase()
    let cutoff = 0 // limite inferior (>= cutoff)
    let ate = 0    // limite superior (< ate) — só no range custom
    // `agoraMs` é state (relógio ao vivo) → cálculo puro no render (sem Date.now/new Date() argless).
    if (filtroData === 'hoje') { const d = new Date(agoraMs); d.setHours(0, 0, 0, 0); cutoff = d.getTime() }
    else if (filtroData === '7') cutoff = agoraMs - 7 * 86400000
    else if (filtroData === '30') cutoff = agoraMs - 30 * 86400000
    else if (filtroData === 'custom') {
      if (criadoDe) { const t = Date.parse(`${criadoDe}T00:00:00`); if (!Number.isNaN(t)) cutoff = t }
      if (criadoAte) { const t = Date.parse(`${criadoAte}T23:59:59`); if (!Number.isNaN(t)) ate = t }
    }
    return ops.filter((o) => {
      if (f && !`${o.pmo}/${o.op} ${o.cliente ?? ''}`.toLowerCase().includes(f)) return false
      if (cutoff > 0 || ate > 0) {
        const t = Date.parse(o.criadoEm)
        if (!Number.isNaN(t)) {
          if (cutoff > 0 && t < cutoff) return false
          if (ate > 0 && t > ate) return false
        }
      }
      return true
    })
  }, [ops, filtroOp, filtroData, criadoDe, criadoAte, agoraMs])

  const rotuloOpSel = useMemo(() => {
    const o = ops.find((x) => `${x.pmo}||${x.op}` === sel)
    return o ? `${o.pmo}/${o.op}${o.cliente ? ` · ${o.cliente}` : ''}` : ''
  }, [ops, sel])

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-1 flex-col gap-1.5 sm:max-w-md sm:min-w-64">
            <Label>OP</Label>
            {/* Combobox (Popover + input) — o Select do Radix sequestrava as teclas (typeahead) e
                pulava a posição (item-aligned). Aqui o input mantém o foco e a lista abre SEMPRE
                ancorada no campo (side=bottom): acima é o cabeçalho, fixar "pra cima" cliparia. */}
            <Popover open={opAberto} onOpenChange={(o) => { setOpAberto(o); if (!o) setFiltroOp('') }}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <span className={rotuloOpSel ? 'truncate' : 'truncate text-muted-foreground'}>{rotuloOpSel || 'Selecione a OP'}</span>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                  </button>
                }
              />
              <PopoverContent side="bottom" align="start" sideOffset={4} className="w-[22rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
                <div className="flex flex-col gap-1.5 border-b border-border p-1.5">
                  <input
                    ref={opFiltroRef}
                    autoFocus
                    value={filtroOp}
                    onChange={(e) => setFiltroOp(e.target.value)}
                    placeholder="Filtrar por PMO / OP / cliente…"
                    className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  {/* Filtro por data de CRIAÇÃO da OP (presets + período custom). */}
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <span className="mr-0.5 text-muted-foreground">Criada:</span>
                    {([['tudo', 'Tudo'], ['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['custom', 'Período']] as const).map(([val, rot]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setFiltroData(val)}
                        className={`rounded-md border px-2 py-0.5 font-medium ${filtroData === val ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-accent'}`}
                      >
                        {rot}
                      </button>
                    ))}
                  </div>
                  {filtroData === 'custom' && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <input type="date" value={criadoDe} onChange={(e) => setCriadoDe(e.target.value)} aria-label="Criada de" className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
                      <span className="text-muted-foreground">até</span>
                      <input type="date" value={criadoAte} onChange={(e) => setCriadoAte(e.target.value)} aria-label="Criada até" className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
                    </div>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                  {opsFiltradas.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma OP encontrada.</p>
                  ) : (
                    opsFiltradas.map((o) => {
                      const val = `${o.pmo}||${o.op}`
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => { escolher(val); setOpAberto(false); setFiltroOp('') }}
                          className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent ${sel === val ? 'bg-accent font-medium' : ''}`}
                        >
                          {o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}
                        </button>
                      )
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-wrap items-center gap-3 pb-1">
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
              <Button variant="outline" size="sm" onClick={redefinirLayout} title="Volta os cards à posição padrão">
                <RotateCcw className="mr-1 size-4" /> Redefinir
              </Button>
            )}
            {buscou && (
              <Button variant="outline" size="sm" onClick={alternarTv}>
                <Maximize2 className="mr-1 size-4" /> Modo TV
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setApresPainel(true)} title="Montar e rodar uma apresentação (playlist de OPs/telas)">
              <MonitorPlay className="mr-1 size-4" /> Apresentação{playlist.length > 0 ? ` (${playlist.length})` : ''}
            </Button>
          </div>
        </div>

        {/* Painel pra montar a playlist da apresentação. */}
        {apresPainel && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/50 p-4 backdrop-blur-sm" onClick={() => setApresPainel(false)}>
            <div className="mt-10 flex max-h-[85vh] w-[min(94%,40rem)] flex-col rounded-xl border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-base font-semibold">Apresentação · playlist</p>
                <button type="button" onClick={() => setApresPainel(false)} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-4" /></button>
              </div>

              {/* Adicionar slide: OP + view */}
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <div className="flex min-w-48 flex-1 flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">OP</label>
                  <Select value={addOp} onValueChange={(v) => setAddOp(v ?? '')} onOpenChange={(open) => { if (!open) setFiltroAddOp('') }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Escolha a OP" /></SelectTrigger>
                    <SelectContent className="w-auto min-w-[20rem] max-w-[calc(100vw-2rem)]">
                      <div className="sticky top-0 z-10 border-b border-border bg-popover p-1.5" onPointerDown={(e) => e.stopPropagation()}>
                        <input
                          value={filtroAddOp}
                          onChange={(e) => setFiltroAddOp(e.target.value)}
                          onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}
                          placeholder="Filtrar por PMO / OP / cliente…"
                          className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                      </div>
                      {(() => {
                        const f = filtroAddOp.trim().toLowerCase()
                        const lista = f ? ops.filter((o) => `${o.pmo}/${o.op} ${o.cliente ?? ''}`.toLowerCase().includes(f)) : ops
                        return lista.length === 0
                          ? <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma OP encontrada.</p>
                          : lista.map((o) => <SelectItem key={`${o.pmo}||${o.op}`} value={`${o.pmo}||${o.op}`}>{o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}</SelectItem>)
                      })()}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">View</label>
                  <Select value={addView} onValueChange={(v) => setAddView((v ?? 'fluxo') as ViewSlide)}>
                    <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fluxo">Fluxo</SelectItem>
                      <SelectItem value="defeitos">Defeitos</SelectItem>
                      <SelectItem value="dashboard">Dashboard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="outline" onClick={() => adicionarSlide(addView)}><Plus className="mr-1 size-4" /> Add</Button>
                <Button size="sm" variant="ghost" onClick={adicionarTodasViews} title="Adiciona Fluxo + Defeitos + Dashboard desta OP">+ 3 views</Button>
              </div>

              {/* Lista de slides */}
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
                {playlist.length === 0 ? (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum slide ainda — adicione OP + view acima.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {playlist.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                        <span className="flex-1 truncate">{s.pmo}/{s.op} · <span className="font-medium">{ROTULO_VIEW[s.view]}</span></span>
                        <button type="button" onClick={() => moverSlide(i, -1)} disabled={i === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Subir"><ChevronLeft className="size-4 rotate-90" /></button>
                        <button type="button" onClick={() => moverSlide(i, 1)} disabled={i === playlist.length - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Descer"><ChevronRight className="size-4 rotate-90" /></button>
                        <button type="button" onClick={() => removerSlide(i)} className="p-1 text-muted-foreground hover:text-red-600" aria-label="Remover"><Trash2 className="size-4" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  Tempo por slide:
                  <input type="number" min={3} max={120} value={tempoSlide} onChange={(e) => setTempoSlide(Math.max(3, Number(e.target.value) || 15))} className="h-8 w-16 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring" /> s
                </label>
                <Button size="sm" onClick={iniciarApresentacao} disabled={playlist.length === 0} className="bg-enterplak hover:bg-enterplak-700">
                  <Play className="mr-1 size-4" /> Iniciar
                </Button>
              </div>
            </div>
          </div>
        )}

        {buscou && !carregando && nodes.length === 0 && (
          <p className="text-sm text-muted-foreground">Esta OP não tem postos no fluxo.</p>
        )}

        <div ref={canvasRef} className="fluxo-canvas relative h-[70vh] w-full overflow-hidden rounded-lg border border-border bg-neutral-100">
          {/* Transição entre fluxos: borra o canvas atual + spinner enquanto carrega a OP nova. */}
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

          {/* Botão de canto "Defeitos" — no canvas (canto inferior-direito); alcança no Modo TV também. */}
          {buscou && !defeitosAberto && (
            <button
              type="button"
              onClick={() => setDefeitosAberto(true)}
              title="Defeitos desta OP (→)"
              className="absolute bottom-3 right-3 z-40 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium shadow-lg hover:bg-accent"
            >
              <Bug className="size-4" /> Defeitos <ChevronRight className="size-4 opacity-60" />
            </button>
          )}
          {/* Painel de Defeitos da OP — dentro do Fluxo (cobre o canvas); funciona no Modo TV/apresentação. */}
          {defeitosAberto && (
            <div className="absolute inset-0 z-50 flex flex-col gap-2 bg-card p-3">
              <div className="flex shrink-0 items-center justify-between">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setDefeitosAberto(false)} title="Voltar ao Fluxo (←)" className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"><ChevronLeft className="size-4" /> Fluxo</button>
                  <p className="text-sm font-semibold">Defeitos · {opInfo.pmo}/{opInfo.op}</p>
                </div>
                <button type="button" onClick={() => setDefeitosAberto(false)} aria-label="Fechar" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-4" /></button>
              </div>
              <DefeitosLista pmo={opInfo.pmo} op={opInfo.op} postos={postosOP} postoInfo={postoInfoMap} />
            </div>
          )}
          {/* Botão de Filtro (vinho, só ícone) — no topo do canvas; aparece também no Modo TV. */}
          {buscou && !filtroAberto && (
            <button
              type="button"
              onClick={() => setFiltroAberto(true)}
              title={`Filtro & busca de SN — ${rotuloJanela(janela, custom)}`}
              aria-label="Filtro e busca de SN"
              // Com a aba lateral do posto aberta (w-80 = 20rem), desloca pra fora dela pra não cobrir o X de fechar.
              className={`absolute z-40 flex size-9 items-center justify-center rounded-full bg-enterplak text-white shadow-lg hover:bg-enterplak-700 ${telaCheia ? 'top-[4.75rem]' : 'top-3'} ${detalhe ? 'right-[20.75rem]' : 'right-3'}`}
            >
              <SlidersHorizontal className="size-4" />
            </button>
          )}
          {/* Painel de Filtro + Busca — barra HORIZONTAL no topo, NÃO cobre o fluxo (dá pra ver o resultado). */}
          {filtroAberto && (
            <div className={`absolute left-3 z-40 rounded-xl border border-border bg-card p-3 shadow-xl ${telaCheia ? 'top-[4.75rem]' : 'top-3'} ${detalhe ? 'right-[20.75rem]' : 'right-3'}`}>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2 pr-8">
                {/* Busca de SN */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Buscar SN</label>
                  <div className="relative flex items-center">
                    <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
                    <input
                      value={buscaSn}
                      onChange={(e) => setBuscaSn(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscarRota() } }}
                      placeholder="SN + Enter"
                      className="h-9 w-44 rounded-md border border-input bg-transparent pl-8 pr-12 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                    <button type="button" onClick={buscarRota} className="absolute right-1.5 rounded px-2 py-0.5 text-sm font-medium text-enterplak hover:underline">Ver</button>
                  </div>
                </div>
                {buscaSn.trim() !== '' && <button type="button" onClick={() => setSnAberto(buscaSn.trim())} className="h-9 self-end text-xs font-medium text-enterplak hover:underline">Linha do tempo</button>}
                {rota && <button type="button" onClick={limparRota} className="h-9 self-end text-xs text-muted-foreground hover:text-red-600">Limpar rota</button>}

                {/* Data */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Data</label>
                  <input type="date" value={dataEfetiva} onChange={(e) => { setDataFiltro(e.target.value); setFiltroAplicado(true) }} className="h-9 w-36 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
                </div>

                {/* Janela */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Janela</label>
                  <div className="flex flex-wrap gap-1.5">
                    {([['dia', 'Dia'], ['matutino', 'Matutino'], ['vespertino', 'Vespertino'], ['custom', 'Personalizado']] as const).map(([val, rot]) => (
                      <button key={val} type="button" onClick={() => { setJanela(val); setFiltroAplicado(true) }} className={`h-9 rounded-md border px-2.5 text-sm font-medium ${filtroAplicado && janela === val ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-accent'}`}>{rot}</button>
                    ))}
                  </div>
                </div>

                {/* Personalizado */}
                {janela === 'custom' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">De / até</label>
                    <div className="flex items-center gap-1.5">
                      <input type="time" value={custom.ini} onChange={(e) => { setCustom((c) => ({ ...c, ini: e.target.value })); setFiltroAplicado(true) }} className="h-9 w-28 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring" />
                      <span className="text-muted-foreground">–</span>
                      <input type="time" value={custom.fim} onChange={(e) => { setCustom((c) => ({ ...c, fim: e.target.value })); setFiltroAplicado(true) }} className="h-9 w-28 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring" />
                    </div>
                  </div>
                )}

                {/* Produção total */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Peças</label>
                  <button type="button" onClick={() => setProducaoTotal((v) => !v)} title="O tempo/cadência sempre segue a janela do filtro" className={`h-9 rounded-md border px-3 text-sm font-medium ${producaoTotal ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-accent'}`}>
                    {producaoTotal ? '✓ Total' : 'Do período'}
                  </button>
                </div>

                {filtroAplicado && (
                  <button
                    type="button"
                    onClick={() => { setFiltroAplicado(false); setJanela('dia'); setDataFiltro(''); setCustom({ ini: MATUTINO.ini, fim: MATUTINO.fim }); setProducaoTotal(false) }}
                    className="h-9 self-end rounded-md border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-red-600"
                  >
                    Limpar filtro
                  </button>
                )}
                <p className="self-end pb-2 text-xs text-muted-foreground">
                  {filtroAplicado ? <>Janela: <span className="font-medium text-foreground">{minutosEfetivos}</span> min</> : 'Sem filtro · visão macro (por dia)'}
                </p>
              </div>
              <button type="button" onClick={() => setFiltroAberto(false)} aria-label="Fechar" className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-4" /></button>
            </div>
          )}

          {/* MODO APRESENTAÇÃO: barra de controle no topo + overlay da view do slide (defeitos/dashboard). */}
          {apresentando && slideAtual && (
            <>
              <div className="absolute inset-x-0 top-0 z-[60] flex items-center justify-between gap-3 border-b border-border bg-card/90 px-4 py-2 backdrop-blur">
                <p className="min-w-0 truncate text-sm font-semibold">
                  {slideAtual.pmo}/{slideAtual.op} · {ROTULO_VIEW[slideAtual.view]}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{slideIdx + 1}/{playlist.length}</span>
                </p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setSlideIdx((i) => (i - 1 + playlist.length) % playlist.length)} className="rounded-md p-1.5 hover:bg-accent" aria-label="Anterior"><ChevronLeft className="size-4" /></button>
                  <button type="button" onClick={() => setSlideIdx((i) => (i + 1) % playlist.length)} className="rounded-md p-1.5 hover:bg-accent" aria-label="Próximo"><ChevronRight className="size-4" /></button>
                  <button type="button" onClick={sairApresentacao} className="ml-1 flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-sm font-medium hover:bg-accent"><Minimize2 className="size-4" /> Sair (Esc)</button>
                </div>
              </div>
              {slideAtual.view === 'defeitos' && (
                <div className="absolute inset-0 z-[55] flex flex-col bg-card p-3 pt-14">
                  <DefeitosLista pmo={slideAtual.pmo} op={slideAtual.op} />
                </div>
              )}
              {slideAtual.view === 'dashboard' && (
                <div className="absolute inset-0 z-[55] overflow-auto bg-card p-3 pt-14">
                  <DashboardForm ordens={ordensDashboard} opInicial={{ cliente: slideAtual.cliente, pmo: slideAtual.pmo, op: slideAtual.op }} />
                </div>
              )}
            </>
          )}

          {telaCheia && !apresentando && (
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

          {/* Gráfico de produção — painel INFERIOR, fora da aba lateral do posto (à esquerda dela). */}
          {detalhe && !detalhe.ehManutencao && (
            <div className="absolute bottom-3 left-3 right-[20.75rem] z-30 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
              <GraficoProducao key={aberto} pmo={opInfo.pmo} op={opInfo.op} posto={aberto ?? ''} ini={graficoRange.ini} fim={graficoRange.fim} bucket={graficoRange.bucket} />
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

              <div
                className="flex-1 overflow-y-auto px-4 py-3 text-sm"
                onScroll={(e) => {
                  const el = e.currentTarget
                  // Lazy load: perto do fim, revela +100 nas listas.
                  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) setLimite((l) => l + 100)
                }}
              >
                {detalhe.ehManutencao ? (
                  <>
                    <p className="mb-3 text-enterplak">Em manutenção agora: <span className="font-bold">{detalhe.wip}</span></p>
                    <ListaSns titulo="Peças travadas" itens={listas.agora} carregando={carregandoSns} onSn={setSnAberto} limite={limite} />
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
                        <ListaSimples titulo="Entrada" itens={burnin.entradas.map((e) => ({ sn: e.sn, dir: fmtHora(e.dataHora) }))} onSn={setSnAberto} limite={limite} />
                        <ListaSimples titulo="Saída" itens={burnin.saidas.map((s) => ({ sn: s.sn, dir: s.status }))} onSn={setSnAberto} limite={limite} />
                      </>
                    ) : detalhe.recurso === 'caixa' ? (
                      <ListaSimples titulo="Embaladas (peça · caixa)" itens={caixas.map((c) => ({ sn: c.sn, dir: c.caixa }))} onSn={setSnAberto} limite={limite} />
                    ) : (
                      <>
                        {naoIniciadasPrimeiro > 0 && (
                          <p className="mb-2 text-xs text-muted-foreground">
                            Inclui <span className="font-semibold text-foreground">{naoIniciadasPrimeiro}</span> não iniciada{naoIniciadasPrimeiro > 1 ? 's' : ''} (ainda sem bipe), na lista abaixo.
                          </p>
                        )}
                        <PendentesPosto titulo="Pendentes no posto" itens={listas.agora} carregando={carregandoSns} onSn={setSnAberto} defaultOpen />
                        <HistoricoPosto key={aberto} pmo={opInfo.pmo} op={opInfo.op} posto={aberto ?? ''} onSn={setSnAberto} />
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
          container={containerTv ?? undefined}
        />
      </CardContent>
    </Card>
  )
}
