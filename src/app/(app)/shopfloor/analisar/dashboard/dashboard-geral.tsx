'use client'

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { carregarDashboardGeral } from '@/modules/shopfloor/application/dashboard-actions'
import {
  COMO_CALCULA, FILTRO_PADRAO, OPS_POR_PAGINA,
  type DadosDashboard, type FiltroDashboard, type OpPorStatus, type Ranking,
} from '@/modules/shopfloor/domain/dashboard'
import { capitalizarDescricaoDefeito, separarCodigoDefeito } from '@/modules/shopfloor/domain/defeito'
import type { OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'

const TODOS = '__todos__'
const fmt = new Intl.NumberFormat('pt-BR')
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })
const ROTULO_STATUS: Record<string, string> = { aberta: 'Em aberto', finalizada: 'Finalizadas', [TODOS]: 'Todas' }

// Cores das marcas (barras e pontos), validadas no script de daltonismo/contraste: o par
// aprovado×reprovado precisa de LUMINOSIDADES diferentes, senão quem tem daltonismo verde-vermelho
// não separa os dois numa barra empilhada — o verde/vermelho "padrão" deu ΔE 4 (mínimo 8).
// Claro: #15803d × #f87171 (ΔE 8,7) · Escuro: #47ab4f × #ba3630 (ΔE 11,9). Texto nunca usa estas
// cores: número e rótulo ficam na cor de texto, e a identidade vem do ponto/barra ao lado.
const COR_APROVADO = 'bg-[#15803d] dark:bg-[#47ab4f]'
const COR_REPROVADO = 'bg-[#f87171] dark:bg-[#ba3630]'
const COR_NEUTRA = 'bg-muted-foreground/35'
const COR_MARCA = 'bg-[#8D2033] dark:bg-[#d2566c]'

function corDoStatus(status: string): string {
  const s = status.toLowerCase()
  if (s === 'aprovado') return COR_APROVADO
  if (s === 'reprovado') return COR_REPROVADO
  return COR_NEUTRA
}

/** Aprovado, Reprovado e depois o que mais aparecer — ordem fixa, pra cor não trocar de lugar. */
function ordenarStatus(statuses: Iterable<string>): string[] {
  const peso = (s: string) => (s.toLowerCase() === 'aprovado' ? 0 : s.toLowerCase() === 'reprovado' ? 1 : 2)
  return [...new Set(statuses)].sort((a, b) => peso(a) - peso(b) || a.localeCompare(b, 'pt-BR'))
}

/**
 * Dashboard geral — substitui o relatório do Looker Studio, que lia da planilha do ShopFloor legado.
 * As MÉTRICAS são as do legado (cada gráfico conferido na configuração de lá); os números não batem
 * porque a fonte é outra. Tudo agregado no banco (0101) — o PostgREST corta em 1000 linhas.
 */
export function DashboardGeral({ ordens, postos, colaboradores }: {
  ordens: OrdemPesquisa[]; postos: string[]; colaboradores: string[]
}) {
  const [filtro, setFiltro] = useState<FiltroDashboard>(FILTRO_PADRAO)
  // O Nº de série só vira filtro no Enter ou ao sair do campo: consultar a cada tecla faria uma
  // rodada de agregações por dígito digitado.
  const [snDigitado, setSnDigitado] = useState('')
  const [pagina, setPagina] = useState(0)
  const [dados, setDados] = useState<DadosDashboard | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, start] = useTransition()

  // Recarrega a cada mudança de filtro ou de página. O filtro entra na dependência como JSON porque é
  // um objeto novo a cada render — comparar por referência recarregaria sempre.
  const chave = JSON.stringify(filtro)
  useEffect(() => {
    start(async () => {
      const r = await carregarDashboardGeral(filtro, pagina)
      if (r.ok) { setDados(r.dados); setErro(null) }
      else { setDados(null); setErro(r.erro); toast.error(r.erro) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `chave` já representa o filtro inteiro
  }, [chave, pagina])

  // As listas dos filtros saem das OPs cadastradas — não do resultado, senão o filtro sumiria
  // justamente quando o recorte não tem dado, e a pessoa ficaria sem como voltar atrás.
  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))].sort(), [ordens])
  const pmos = useMemo(() => {
    const base = filtro.cliente ? ordens.filter((o) => o.cliente === filtro.cliente) : ordens
    return [...new Set(base.map((o) => o.pmo))].sort()
  }, [ordens, filtro.cliente])
  const ops = useMemo(() => {
    const base = ordens.filter((o) => (!filtro.cliente || o.cliente === filtro.cliente) && (!filtro.pmo || o.pmo === filtro.pmo))
    return [...new Set(base.map((o) => o.op))].sort()
  }, [ordens, filtro.cliente, filtro.pmo])

  // Trocar um filtro volta pra primeira página: manter a página 3 num recorte que só tem 1 é mostrar
  // tela vazia sem explicar por quê.
  function mudar(patch: Partial<FiltroDashboard>) {
    setPagina(0)
    setFiltro((f) => ({ ...f, ...patch }))
  }
  function aplicarSn() {
    if (snDigitado.trim() !== filtro.sn) mudar({ sn: snDigitado.trim() })
  }
  function limpar() {
    setSnDigitado('')
    setPagina(0)
    setFiltro(FILTRO_PADRAO)
  }

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.opsTotal / OPS_POR_PAGINA)) : 1
  const alterado = chave !== JSON.stringify(FILTRO_PADRAO)

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Filtros: uma faixa acima de tudo, e tudo abaixo responde a ela ---------- */}
      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <CampoSelect rotulo="Cliente" valor={filtro.cliente} opcoes={clientes}
            onChange={(v) => mudar({ cliente: v, pmo: '', op: '' })} />
          <CampoSelect rotulo="PMO" valor={filtro.pmo} opcoes={pmos} onChange={(v) => mudar({ pmo: v, op: '' })} />
          <CampoSelect rotulo="OP" valor={filtro.op} opcoes={ops} onChange={(v) => mudar({ op: v })} />
          <div className="flex flex-col gap-1.5">
            <Label>Status da OP</Label>
            <Select value={filtro.statusOp === '' ? TODOS : filtro.statusOp}
              onValueChange={(v) => mudar({ statusOp: !v || v === TODOS ? '' : (v as 'aberta' | 'finalizada') })}>
              <SelectTrigger className="h-9">
                <SelectValue>
                  {(v: string | null) => ROTULO_STATUS[String(v ?? TODOS)] ?? 'Todas'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aberta">Em aberto</SelectItem>
                <SelectItem value="finalizada">Finalizadas</SelectItem>
                <SelectItem value={TODOS}>Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CampoSelect rotulo="Posto" valor={filtro.posto} opcoes={postos} onChange={(v) => mudar({ posto: v })} />
          <CampoSelect rotulo="Colaborador" valor={filtro.colaborador} opcoes={colaboradores}
            onChange={(v) => mudar({ colaborador: v })} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dash-sn">Nº de série</Label>
            <Input id="dash-sn" value={snDigitado} className="h-9" placeholder="Enter para buscar"
              onChange={(e) => setSnDigitado(e.target.value)}
              onBlur={aplicarSn}
              onKeyDown={(e) => { if (e.key === 'Enter') aplicarSn() }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dash-de">De</Label>
            <Input id="dash-de" type="date" value={filtro.de} className="h-9" onChange={(e) => mudar({ de: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dash-ate">Até</Label>
            <Input id="dash-ate" type="date" value={filtro.ate} className="h-9" onChange={(e) => mudar({ ate: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="h-9 w-full" disabled={!alterado && snDigitado === ''} onClick={limpar}>
              Limpar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {erro && !carregando && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">{erro}</p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Se este ambiente é novo, confira se a migração <span className="font-mono">0101</span> foi aplicada.
          </p>
        </div>
      )}
      {carregando && !dados && !erro && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {dados && (
        // Recarregando: segura a foto anterior esmaecida, sem pular o layout nem piscar em branco.
        <div className={`flex flex-col gap-4 transition-opacity ${carregando ? 'opacity-60' : ''}`}>
          {/* ---------- Indicadores (peças) ---------- */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Indicador rotulo="Total" valor={dados.totais.total} explica={COMO_CALCULA.total} />
            <Indicador rotulo="Aprovado" valor={dados.totais.aprovado} explica={COMO_CALCULA.aprovado} cor={COR_APROVADO} />
            <Indicador rotulo="Reprovado" valor={dados.totais.reprovado} explica={COMO_CALCULA.reprovado} cor={COR_REPROVADO} />
          </div>
          <p className="-mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            Contagem por <strong>peça</strong>. Aprovado + Reprovado não fecha com o Total
            <Explica texto={COMO_CALCULA.soma} />
            <span>· {fmt.format(dados.totais.bipes)} bipes em {fmt.format(dados.totais.ops)} OPs</span>
          </p>

          {/* ---------- Tabela OP × posto (peças por status) ---------- */}
          <Card>
            <CardContent className="flex flex-col gap-3 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Titulo titulo="Peças por OP e posto" regua="peças" explica={COMO_CALCULA.grade} />
                <Legenda itens={[['Aprovadas', COR_APROVADO], ['Reprovadas', COR_REPROVADO], ['Sem status', COR_NEUTRA]]} />
              </div>
              {dados.grade.ops.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma OP com movimento neste filtro.</p>
              ) : (
                <>
                  {/* Tabela larga por natureza (uma coluna por posto): rola no próprio container. */}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 z-10 bg-card">PMO·OP</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right">Peças</TableHead>
                          {dados.grade.postos.map((p) => (
                            <TableHead key={p} className="whitespace-nowrap text-center">{p}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dados.grade.ops.map((o) => (
                          <TableRow key={`${o.pmo}|${o.op}`}>
                            <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-card font-medium">
                              {o.pmo}·{o.op}
                              {o.finalizada && <span className="ml-2 text-xs font-normal text-muted-foreground">finalizada</span>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">{o.cliente}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{fmt.format(o.pecas)}</TableCell>
                            {dados.grade.postos.map((p) => {
                              const c = o.porPosto[p]
                              if (!c) return <TableCell key={p} className="text-center text-muted-foreground/40">—</TableCell>
                              return (
                                <TableCell key={p} className="text-center tabular-nums"
                                  title={`${o.pmo}·${o.op} · ${p}: ${fmt.format(c.aprovados)} aprovadas, ${fmt.format(c.reprovados)} reprovadas, ${fmt.format(c.semStatus)} sem status (peças)`}>
                                  <span className="inline-flex items-center gap-2.5">
                                    {c.aprovados > 0 && <Numero cor={COR_APROVADO} valor={c.aprovados} />}
                                    {c.reprovados > 0 && <Numero cor={COR_REPROVADO} valor={c.reprovados} />}
                                    {c.semStatus > 0 && <Numero cor={COR_NEUTRA} valor={c.semStatus} />}
                                  </span>
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {fmt.format(dados.opsTotal)} OP{dados.opsTotal === 1 ? '' : 's'} · página {pagina + 1} de {totalPaginas}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={pagina === 0 || carregando}
                        onClick={() => setPagina((p) => Math.max(0, p - 1))}>Anterior</Button>
                      <Button variant="outline" size="sm" disabled={pagina + 1 >= totalPaginas || carregando}
                        onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ---------- Gráficos (registros) ---------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <CardGrafico titulo="Bipes por status" regua="registros" explica={COMO_CALCULA.status}>
              <BarraProporcao ranking={dados.graficos.status} vazio="Nenhum bipe com status neste filtro." />
            </CardGrafico>
            <CardGrafico titulo="Reprovas por tipo de componente" regua="registros" explica={COMO_CALCULA.tipo}>
              <BarrasRanking ranking={dados.graficos.tipo} vazio="Nenhuma reprova com tipo neste filtro." />
            </CardGrafico>
          </div>

          <CardGrafico titulo="Bipes por OP e status" regua="registros" explica={COMO_CALCULA.ops}
            acao={<Legenda itens={ordenarStatus(dados.graficos.ops.flatMap((o) => Object.keys(o.porStatus))).map((s) => [s, corDoStatus(s)])} />}>
            <BarrasPorOp ops={dados.graficos.ops} />
          </CardGrafico>

          <div className="grid gap-4 lg:grid-cols-2">
            <CardGrafico titulo="Principais defeitos" regua="registros" explica={COMO_CALCULA.defeitos}>
              <BarrasRanking ranking={dados.graficos.defeitos} vazio="Nenhuma reprova com defeito neste filtro."
                rotulo={(codigo) => {
                  const { numero, descricao } = separarCodigoDefeito(codigo)
                  const texto = capitalizarDescricaoDefeito(descricao) || codigo
                  return numero ? `${texto} · ${numero}` : texto
                }} />
            </CardGrafico>
            <CardGrafico titulo="Principais posições" regua="registros" explica={COMO_CALCULA.posicoes}>
              <BarrasRanking ranking={dados.graficos.posicoes} vazio="Nenhuma reprova com posição neste filtro." />
            </CardGrafico>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peças da tela
// ---------------------------------------------------------------------------

/** O "ⓘ" de como é calculado. Abre no hover (e no toque, no tablet), fora do Card — que corta o que vaza. */
function Explica({ texto }: { texto: string }) {
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={120} aria-label="Como é calculado"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80 gap-1 text-xs leading-relaxed">
        <p className="font-semibold text-foreground">Como é calculado</p>
        <p className="text-muted-foreground">{texto}</p>
      </PopoverContent>
    </Popover>
  )
}

function Titulo({ titulo, regua, explica }: { titulo: string; regua: 'peças' | 'registros'; explica: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <p className="text-sm font-semibold text-foreground">{titulo}</p>
      {/* A régua fica À VISTA: na mesma tela os cartões contam peças e os gráficos contam bipes, e
          sem isto "Aprovado" com dois números diferentes parece erro. */}
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{regua}</span>
      <Explica texto={explica} />
    </div>
  )
}

function CardGrafico({ titulo, regua, explica, acao, children }: {
  titulo: string; regua: 'peças' | 'registros'; explica: string; acao?: ReactNode; children: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Titulo titulo={titulo} regua={regua} explica={explica} />
          {acao}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

function Indicador({ rotulo, valor, explica, cor }: { rotulo: string; valor: number; explica: string; cor?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <div className="flex items-center gap-1.5">
          {cor && <span className={`size-2.5 rounded-full ${cor}`} aria-hidden />}
          <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">peças</span>
          <Explica texto={explica} />
        </div>
        <p className="text-3xl font-bold text-foreground">{fmt.format(valor)}</p>
      </CardContent>
    </Card>
  )
}

function Legenda({ itens }: { itens: [string, string][] }) {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {itens.map(([rotulo, cor]) => (
        <li key={rotulo} className="inline-flex items-center gap-1.5">
          <span className={`size-2.5 rounded-sm ${cor}`} aria-hidden />{rotulo}
        </li>
      ))}
    </ul>
  )
}

function Numero({ cor, valor }: { cor: string; valor: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`size-2 rounded-full ${cor}`} aria-hidden />
      {fmt.format(valor)}
    </span>
  )
}

/** Ranking em barras horizontais, uma série só: os N maiores + "Outros" em cinza, valor na ponta. */
function BarrasRanking({ ranking, vazio, rotulo = (r) => r }: {
  ranking: Ranking; vazio: string; rotulo?: (r: string) => string
}) {
  const itens = [
    ...ranking.topo.map((i) => ({ chave: i.rotulo, texto: rotulo(i.rotulo), valor: i.valor, outros: false })),
    ...(ranking.outros > 0 ? [{ chave: '__outros__', texto: 'Outros', valor: ranking.outros, outros: true }] : []),
  ]
  if (itens.length === 0) return <p className="text-sm text-muted-foreground">{vazio}</p>
  const maior = Math.max(...itens.map((i) => i.valor))
  return (
    <ul className="flex flex-col gap-1.5">
      {itens.map((i) => (
        <li key={i.chave} title={`${i.texto}: ${fmt.format(i.valor)}`}
          className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className={`truncate ${i.outros ? 'text-muted-foreground' : 'text-foreground'}`}>{i.texto}</span>
          <div className="h-3.5">
            <div className={`h-full rounded-r-[4px] ${i.outros ? COR_NEUTRA : COR_MARCA}`}
              style={{ width: `max(2px, ${(i.valor / maior) * 100}%)` }} />
          </div>
          <span className="text-right tabular-nums font-medium text-foreground">{fmt.format(i.valor)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Parte-do-todo com poucos itens: uma barra 100% dividida + os números. Mais legível que pizza de 2 fatias. */
function BarraProporcao({ ranking, vazio }: { ranking: Ranking; vazio: string }) {
  const itens = [
    ...ranking.topo.map((i) => ({ rotulo: i.rotulo, valor: i.valor, cor: corDoStatus(i.rotulo) })),
    ...(ranking.outros > 0 ? [{ rotulo: 'Outros', valor: ranking.outros, cor: COR_NEUTRA }] : []),
  ]
  const total = itens.reduce((s, i) => s + i.valor, 0)
  if (total === 0) return <p className="text-sm text-muted-foreground">{vazio}</p>
  const ordenados = ordenarStatus(itens.map((i) => i.rotulo)).map((r) => itens.find((i) => i.rotulo === r)!)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-5 w-full gap-0.5" role="img"
        aria-label={ordenados.map((i) => `${i.rotulo}: ${fmt.format(i.valor)}`).join(', ')}>
        {ordenados.map((i) => (
          <div key={i.rotulo} title={`${i.rotulo}: ${fmt.format(i.valor)} (${pct.format(i.valor / total)})`}
            className={`h-full min-w-[2px] first:rounded-l-[4px] last:rounded-r-[4px] ${i.cor}`}
            style={{ flex: `${i.valor} 1 0%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {ordenados.map((i) => (
          <li key={i.rotulo} className="flex items-center gap-2 text-sm">
            <span className={`size-2.5 rounded-sm ${i.cor}`} aria-hidden />
            <span className="text-muted-foreground">{i.rotulo}</span>
            <span className="tabular-nums font-semibold text-foreground">{fmt.format(i.valor)}</span>
            <span className="tabular-nums text-xs text-muted-foreground">{pct.format(i.valor / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Barras empilhadas por OP (status), escala comum: o comprimento compara OPs, os segmentos o status. */
function BarrasPorOp({ ops }: { ops: OpPorStatus[] }) {
  if (ops.length === 0) return <p className="text-sm text-muted-foreground">Nenhum bipe com status neste filtro.</p>
  const maior = Math.max(...ops.map((o) => o.total))
  return (
    <ul className="flex flex-col gap-1.5">
      {ops.map((o) => {
        const statuses = ordenarStatus(Object.keys(o.porStatus))
        const detalhe = statuses.map((s) => `${fmt.format(o.porStatus[s] ?? 0)} ${s.toLowerCase()}`).join(', ')
        return (
          <li key={`${o.pmo}|${o.op}`} title={`${o.pmo}·${o.op}: ${fmt.format(o.total)} bipes (${detalhe})`}
            className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <span className="truncate text-foreground">{o.pmo}·{o.op}</span>
            <div className="h-3.5">
              <div className="flex h-full gap-0.5" style={{ width: `max(2px, ${(o.total / maior) * 100}%)` }}>
                {statuses.map((s) => (
                  <div key={s} className={`h-full min-w-[2px] last:rounded-r-[4px] ${corDoStatus(s)}`}
                    style={{ flex: `${o.porStatus[s] ?? 0} 1 0%` }} />
                ))}
              </div>
            </div>
            <span className="text-right tabular-nums font-medium text-foreground">{fmt.format(o.total)}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Select de filtro com a opção "todos" — repetido em Cliente/PMO/OP/Posto/Colaborador. */
function CampoSelect({ rotulo, valor, opcoes, onChange }: {
  rotulo: string; valor: string; opcoes: string[]; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{rotulo}</Label>
      <Select value={valor === '' ? TODOS : valor} onValueChange={(v) => onChange(!v || v === TODOS ? '' : v)}>
        <SelectTrigger className="h-9">
          {/* O Select do projeto (Base UI) mostra o VALOR cru sem uma função de renderização —
              apareceria "__todos__" na tela. Mesmo padrão dos filtros de Registros. */}
          <SelectValue placeholder="Todos">
            {(v: string | null) => (!v || v === TODOS ? 'Todos' : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
