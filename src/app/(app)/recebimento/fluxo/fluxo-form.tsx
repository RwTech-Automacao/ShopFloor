'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronsUpDown, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  carregarFluxoEmbAction,
  carregarItensCaixaAction,
} from '@/modules/recebimento/application/fluxo-actions'
import {
  ehEtapa,
  formatarEspera,
  ROTULO_ETAPA,
  temDivergencia,
  type Etapa,
} from '@/modules/recebimento/domain/etapa-processo'
import type { CaixaFluxo, ItemFluxo } from '@/modules/recebimento/infra/fluxo-repository'
import { cn } from '@/lib/utils'
import { FluxoRecebimentoNode, type FluxoRecebimentoNodeData } from './fluxo-node'

const ESPACO_X = 300 // folga entre as caixas (mesma do Fluxo do ShopFloor)
const ESPACO_Y = 200 // altura entre as duas linhas: o ramo do Reprovado desce da Qualidade

/** Arranjo das quatro caixas no canvas: a cadeia na 1ª linha, o ramo embaixo da Qualidade. */
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

/** Cores das arestas, as mesmas do Fluxo do ShopFloor. */
const VINHO = '#8D2033'
const CINZA = '#94a3b8'

function numeroBr(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('pt-BR')
}

export function FluxoForm({ embs }: { embs: string[] }) {
  const [emb, setEmb] = useState('')
  const [aberto, setAberto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [caixas, setCaixas] = useState<CaixaFluxo[] | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  const [etapaSel, setEtapaSel] = useState<Etapa | null>(null)
  const [itens, setItens] = useState<ItemFluxo[] | null>(null)
  const [carregandoItens, setCarregandoItens] = useState(false)

  const rfRef = useRef<ReactFlowInstance | null>(null)

  const embsFiltradas = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return f ? embs.filter((e) => e.toLowerCase().includes(f)) : embs
  }, [embs, filtro])

  const divergentes = useMemo(
    () => (caixas ?? []).reduce((soma, c) => soma + c.divergentes, 0),
    [caixas],
  )
  const total = useMemo(() => (caixas ?? []).reduce((soma, c) => soma + c.itens, 0), [caixas])

  const nodeTypes = useMemo<NodeTypes>(() => ({ etapa: FluxoRecebimentoNode }), [])

  // Os nós não são arrastáveis (são quatro caixas fixas), então saem de um useMemo e não de
  // `useNodesState` — sem estado de posição pra guardar, não há o que sincronizar.
  const nodes = useMemo<Node[]>(() => {
    if (!caixas) return []
    return caixas.map((c) => ({
      id: c.etapa,
      type: 'etapa',
      position: POSICAO[c.etapa],
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
  }, [caixas, etapaSel])

  const edges = useMemo<Edge[]>(() => {
    if (!caixas) return []
    const itensDe = (etapa: Etapa) => caixas.find((c) => c.etapa === etapa)?.itens ?? 0
    /** Caixa de destino com item = linha vinho cheia; vazia = linha cinza fina (igual ao ShopFloor). */
    const cadeia = (source: Etapa, target: Etapa): Edge => ({
      id: `f:${source}->${target}`,
      source,
      target,
      sourceHandle: 'dir',
      targetHandle: 'esq',
      style: itensDe(target) > 0
        ? { stroke: VINHO, strokeWidth: 2 }
        : { stroke: CINZA, strokeWidth: 1 },
    })
    return [
      cadeia('recebimento', 'qualidade'),
      cadeia('qualidade', 'almoxarifado'),
      {
        // O ramo do Reprovado é desenhado como o ramo da Manutenção do ShopFloor: tracejado vinho,
        // saindo por baixo da Qualidade. A diferença é que dele não se volta.
        id: 'r:qualidade->reprovado',
        source: 'qualidade',
        target: 'reprovado',
        sourceHandle: 'baixo',
        targetHandle: 'topo',
        style: { stroke: VINHO, strokeWidth: 2, strokeDasharray: '4 4', opacity: 0.35 },
      },
    ]
  }, [caixas])

  async function escolher(valor: string) {
    setEmb(valor)
    setAberto(false)
    setFiltro('')
    setEtapaSel(null)
    setItens(null)
    setErro('')
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
    // Clicar de novo na mesma caixa fecha a lista.
    if (etapaSel === etapa) {
      setEtapaSel(null)
      setItens(null)
      return
    }
    setEtapaSel(etapa)
    setItens(null)
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

  const contagemDaCaixa = etapaSel ? (caixas ?? []).find((c) => c.etapa === etapaSel)?.itens ?? 0 : 0
  const truncado = itens !== null && contagemDaCaixa > itens.length

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 sm:max-w-md">
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

        {erro && <p className="text-sm text-red-600">{erro}</p>}
        {carregando && <p className="text-sm text-muted-foreground">Carregando o fluxo da EMB…</p>}

        {caixas && !carregando && (
          <>
            {/* Mesmo canvas do Fluxo do ShopFloor: `fluxo-canvas` é a classe compartilhada que
                esconde os pontos de conexão dos nós. Os cards são fixos (não se arrasta), então
                não há layout pra salvar. Clicar num card lista os itens daquela caixa. */}
            <div className="fluxo-canvas relative h-[50vh] min-h-80 w-full overflow-hidden rounded-lg border border-border bg-neutral-100">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.1}
                maxZoom={4}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                onInit={(inst) => { rfRef.current = inst }}
                onNodeClick={aoClicarNo}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>

            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? 'item' : 'itens'} na EMB {emb} ·{' '}
              {/* Divergência é contador à parte: é marca que viaja com o item, não caixa. */}
              <span className={divergentes > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : undefined}>
                {divergentes} {divergentes === 1 ? 'item' : 'itens'} com divergência
              </span>
            </p>

            {etapaSel && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-tinta">
                  Itens em {ROTULO_ETAPA[etapaSel]}
                </h3>
                {carregandoItens && <p className="text-sm text-muted-foreground">Carregando os itens…</p>}
                {!carregandoItens && itens !== null && itens.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum item nesta etapa.</p>
                )}
                {!carregandoItens && itens !== null && itens.length > 0 && (
                  <>
                    {truncado && (
                      // A consulta tem teto (o PostgREST corta a resposta): avisa em vez de mentir a lista.
                      <p className="text-xs text-amber-600">
                        Mostrando os {itens.length} mais antigos de {contagemDaCaixa}.
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Descrição</TableHead>
                            <TableHead className="text-right">Qtd. pedida</TableHead>
                            <TableHead>Nesta etapa há</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itens.map((i) => (
                            <TableRow key={i.processoId}>
                              <TableCell className="font-medium">
                                {i.item || '—'}
                                {/* O número do processo em letra menor desempata o MESMO item
                                    aparecendo duas vezes na mesma EMB. */}
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">#{i.numero}</span>
                              </TableCell>
                              <TableCell className="max-w-72 truncate" title={i.descricao || undefined}>
                                {i.descricao || '—'}
                              </TableCell>
                              <TableCell
                                className="text-right tabular-nums"
                                // A quantidade recebida não ganha coluna própria (a lista da caixa é
                                // enxuta), mas fica à mão pra conferir a divergência.
                                title={`Recebida: ${numeroBr(i.quantidadeRecebida)}`}
                              >
                                {numeroBr(i.quantidadePedido)}
                                {temDivergencia(i.divergencia) && (
                                  <Badge variant="outline" className="ml-1.5 border-amber-400 text-amber-700 dark:text-amber-400">
                                    <TriangleAlert /> {i.divergencia}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="tabular-nums">{formatarEspera(i.segundos)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
