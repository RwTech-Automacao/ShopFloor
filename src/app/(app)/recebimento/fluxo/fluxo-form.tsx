'use client'

import { Fragment, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ChevronsUpDown, TriangleAlert } from 'lucide-react'
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
  ETAPAS,
  formatarEspera,
  ROTULO_ETAPA,
  temDivergencia,
  type Etapa,
} from '@/modules/recebimento/domain/etapa-processo'
import type { CaixaFluxo, ItemFluxo } from '@/modules/recebimento/infra/fluxo-repository'
import { cn } from '@/lib/utils'

/** Cor de cada caixa. O Reprovado é fim de linha, então sai em vermelho. */
const COR_CAIXA: Record<Etapa, string> = {
  recebimento: 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40',
  qualidade: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30',
  almoxarifado: 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/30',
  reprovado: 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
}

function numeroBr(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('pt-BR')
}

interface CaixaProps {
  caixa: CaixaFluxo
  selecionada: boolean
  onClick: () => void
}

function Caixa({ caixa, selecionada, onClick }: CaixaProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selecionada}
      className={cn(
        'flex min-w-40 flex-1 flex-col gap-1 rounded-lg border p-3 text-left transition-all hover:brightness-95',
        COR_CAIXA[caixa.etapa],
        selecionada && 'ring-2 ring-enterplak ring-offset-1',
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">{ROTULO_ETAPA[caixa.etapa]}</span>
      <span className="text-2xl font-semibold tabular-nums text-tinta">{caixa.itens}</span>
      <span className="text-xs text-muted-foreground">
        {caixa.itens === 1 ? 'item' : 'itens'}
      </span>
      {/* Tempo médio de quanto tempo os itens desta caixa estão NELA — é o que responde
          "essa EMB está travada em quê". */}
      <span className="mt-1 text-xs text-muted-foreground" title="Média de há quanto tempo os itens desta caixa estão nela">
        Tempo médio: <span className="font-medium text-foreground">{formatarEspera(caixa.mediaSegundos)}</span>
      </span>
      <span className="text-xs text-muted-foreground" title="O item mais antigo desta caixa">
        Mais antigo: <span className="font-medium text-foreground">{formatarEspera(caixa.maiorSegundos)}</span>
      </span>
      {caixa.divergentes > 0 && (
        <span className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3.5" /> {caixa.divergentes} com divergência
        </span>
      )}
      {caixa.semTempo > 0 && (
        <span className="text-xs text-muted-foreground" title="Itens sem histórico: aparecem na caixa do status, sem tempo">
          {caixa.semTempo} sem tempo
        </span>
      )}
    </button>
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
  const [itens, setItens] = useState<ItemFluxo[] | null>(null)
  const [carregandoItens, setCarregandoItens] = useState(false)

  const embsFiltradas = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return f ? embs.filter((e) => e.toLowerCase().includes(f)) : embs
  }, [embs, filtro])

  const divergentes = useMemo(
    () => (caixas ?? []).reduce((soma, c) => soma + c.divergentes, 0),
    [caixas],
  )
  const total = useMemo(() => (caixas ?? []).reduce((soma, c) => soma + c.itens, 0), [caixas])

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
            {/* Recebimento → Qualidade → Almoxarifado na 1ª linha; o Reprovado desce da Qualidade
                (coluna 3 da grade), que é a saída lateral. As colunas `auto` são as setas. */}
            <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
              {ETAPAS.filter((e) => e !== 'reprovado').map((etapa, i) => (
                <Fragment key={etapa}>
                  <Caixa
                    caixa={caixas.find((c) => c.etapa === etapa)!}
                    selecionada={etapaSel === etapa}
                    onClick={() => void abrirCaixa(etapa)}
                  />
                  {i < 2 && (
                    <ArrowRight className="hidden size-5 self-center text-muted-foreground sm:block" aria-hidden />
                  )}
                </Fragment>
              ))}
              <div className="flex flex-col gap-1 sm:col-start-3">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowDown className="size-3.5" aria-hidden /> saída lateral (fim de linha)
                </span>
                <Caixa
                  caixa={caixas.find((c) => c.etapa === 'reprovado')!}
                  selecionada={etapaSel === 'reprovado'}
                  onClick={() => void abrirCaixa('reprovado')}
                />
              </div>
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
