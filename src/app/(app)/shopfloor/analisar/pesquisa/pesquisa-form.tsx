'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { FilterX, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buscarHistoricoSN, carregarGrade, carregarGradeCompleta } from '@/modules/shopfloor/application/pesquisa-actions'
import type { RegistroHistorico, OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'
import type { LinhaGrade, ResumoPosto } from '@/modules/shopfloor/domain/grade'
import { pareaBurnin, formatarDuracao } from '@/modules/shopfloor/domain/burnin'
import { FILTROS_VAZIOS, filtrarLinhas, temFiltroAtivo, valoresDistintos, type FiltrosColuna } from '@/modules/shopfloor/domain/grade-filtro'
import { FiltroColuna } from './filtro-coluna'

const TODAS = '__todas__'
/** Linhas por página quando o filtro por coluna pagina no cliente. */
const TAM_PAGINA_CLIENTE = 100

/** Linhas de resumo do topo da grade (Visão Geral da OP), como o legado. */
const RESUMO_LINHAS: { rotulo: string; get: (r: ResumoPosto) => number; soProduzido?: boolean; cls: string }[] = [
  { rotulo: 'Produzido', get: (r) => r.produzido, cls: 'bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200' },
  { rotulo: 'Pendentes', get: (r) => r.pendentes, soProduzido: true, cls: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' },
  { rotulo: 'Aprovados', get: (r) => r.aprovados, soProduzido: true, cls: 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200' },
  { rotulo: 'Reprovados', get: (r) => r.reprovados, soProduzido: true, cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200' },
]

function corCelula(v: string): string {
  // Aprovado/Reprovado também ganham FUNDO (verde/vermelho), não só o texto — pedido da reunião.
  if (v === 'Aprovado' || v === 'Concluído')
    return 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-200 font-medium'
  if (v === 'Reprovado') return 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200 font-medium'
  if (v === 'Em andamento') return 'text-amber-600 font-medium'
  if (v === 'Pendente' || v === '—') return 'text-muted-foreground'
  return 'text-tinta'
}

export function PesquisaForm({ ordens }: { ordens: OrdemPesquisa[] }) {
  // --- busca por SN ---
  const [sn, setSn] = useState('')
  const [registros, setRegistros] = useState<RegistroHistorico[] | null>(null)
  const [buscando, startBusca] = useTransition()

  // --- grade ---
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [colunas, setColunas] = useState<string[]>([])
  const [linhas, setLinhas] = useState<LinhaGrade[] | null>(null)
  const [resumo, setResumo] = useState<ResumoPosto[] | null>(null)
  const [pagina, setPagina] = useState(1)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [total, setTotal] = useState(0)
  const [caixa, setCaixa] = useState('')
  const [carregando, startGrade] = useTransition()

  const resumoPorPosto = useMemo(() => new Map((resumo ?? []).map((r) => [r.posto, r])), [resumo])

  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))], [ordens])
  const pmos = useMemo(
    () => [...new Set(ordens.filter((o) => o.cliente === cliente).map((o) => o.pmo))],
    [ordens, cliente],
  )
  const ops = useMemo(
    () => ordens.filter((o) => o.cliente === cliente && o.pmo === pmo).map((o) => o.op),
    [ordens, cliente, pmo],
  )

  // --- filtro por coluna (estilo Excel) ---
  // Com filtro de coluna OU caixa selecionada, a grade passa a usar a OP INTEIRA (carregada uma vez
  // por OP e guardada aqui) e pagina no cliente; sem filtro nenhum, segue paginada no servidor.
  const [filtros, setFiltros] = useState<FiltrosColuna>(FILTROS_VAZIOS)
  const [completa, setCompleta] = useState<{ chave: string; linhas: LinhaGrade[] } | null>(null)
  const [carregandoCompleta, setCarregandoCompleta] = useState(false)
  // OP grande demais pra filtrar (>5000 SNs): fica fixo, não dá pra tentar de novo.
  const [erroPermanente, setErroPermanente] = useState<{ chave: string; erro: string } | null>(null)
  // Erro transitório (rede/erro interno) da última tentativa: some ao tentar de novo ou trocar de OP.
  const [erroTentativa, setErroTentativa] = useState<{ chave: string; erro: string } | null>(null)
  const [pagCliente, setPagCliente] = useState(1)
  /** OP atual (pmo||op) — guarda contra resposta velha da carga da OP inteira. */
  const chaveAtual = useRef('')
  const emVoo = useRef('')

  const chaveOp = op !== '' ? `${pmo}||${op}` : ''
  const linhasCompletas = completa && completa.chave === chaveOp ? completa.linhas : null
  const indisponivel = erroPermanente && erroPermanente.chave === chaveOp ? erroPermanente.erro : undefined
  const erroDaTentativa = erroTentativa && erroTentativa.chave === chaveOp ? erroTentativa.erro : undefined
  const filtroAtivo = temFiltroAtivo(filtros)
  const modoCompleto = indisponivel === undefined && (filtroAtivo || caixa !== '')

  function garantirCompleta() {
    const chave = chaveOp
    if (chave === '' || (completa && completa.chave === chave) || emVoo.current === chave) return
    if (erroPermanente && erroPermanente.chave === chave) return
    emVoo.current = chave
    setCarregandoCompleta(true)
    setErroTentativa(null)
    carregarGradeCompleta(pmo, op)
      .then((r) => {
        if (chaveAtual.current !== chave) return // trocou de OP no meio: descarta
        if (r.ok) {
          setCompleta({ chave, linhas: r.linhas })
          return
        }
        if (r.permanente) {
          setErroPermanente({ chave, erro: r.erro })
          setFiltros(FILTROS_VAZIOS)
          setCaixa('')
        } else {
          // Erro transitório (OP não encontrada, erro interno…): deixa tentar de novo no próximo clique.
          setErroTentativa({ chave, erro: r.erro })
        }
        toast.error(r.erro, { position: 'bottom-center' })
      })
      .catch(() => {
        if (chaveAtual.current !== chave) return
        const msg = 'Não foi possível carregar a OP inteira.'
        setErroTentativa({ chave, erro: msg })
        toast.error(msg, { position: 'bottom-center' })
      })
      .finally(() => {
        if (emVoo.current === chave) emVoo.current = ''
        if (chaveAtual.current === chave) setCarregandoCompleta(false)
      })
  }

  /** Zera tudo que é da OP anterior (filtros, cache da OP inteira, página do cliente). */
  function trocarOp(chave: string) {
    chaveAtual.current = chave
    emVoo.current = ''
    setFiltros(FILTROS_VAZIOS)
    setCaixa('')
    setPagCliente(1)
    setCompleta(null)
    setErroPermanente(null)
    setErroTentativa(null)
    setCarregandoCompleta(false)
  }

  function mudarFiltros(f: FiltrosColuna) {
    setFiltros(f)
    setPagCliente(1)
  }
  function mudarValoresColuna(coluna: string, sel: string[] | undefined) {
    const valores = { ...filtros.valores }
    if (sel === undefined) delete valores[coluna]
    else valores[coluna] = sel
    mudarFiltros({ ...filtros, valores })
  }

  /** OP inteira recortada pela caixa (base dos valores distintos e do filtro). */
  const baseCompleta = useMemo(() => {
    if (!linhasCompletas) return null
    return caixa === '' ? linhasCompletas : linhasCompletas.filter((l) => l.celulas['Embalagem'] === caixa)
  }, [linhasCompletas, caixa])

  /** Valores distintos por coluna (OP inteira, respeitando a caixa) — alimenta as listas dos funis. */
  const distintos = useMemo(() => {
    const m = new Map<string, string[]>()
    if (baseCompleta) for (const c of colunas) m.set(c, valoresDistintos(baseCompleta, c))
    return m
  }, [baseCompleta, colunas])

  const filtradasCompletas = useMemo(
    () => (baseCompleta ? filtrarLinhas(baseCompleta, filtros) : null),
    [baseCompleta, filtros],
  )
  const totalPagCliente = Math.max(1, Math.ceil((filtradasCompletas?.length ?? 0) / TAM_PAGINA_CLIENTE))
  const pagClienteEf = Math.min(pagCliente, totalPagCliente)

  const caixas = useMemo(() => {
    const fonte = linhasCompletas ?? linhas
    if (!fonte) return []
    const set = new Set<string>()
    for (const l of fonte) {
      const v = l.celulas['Embalagem']
      if (v && v !== 'Pendente' && v !== 'Registrado') set.add(v)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  }, [linhasCompletas, linhas])

  const linhasFiltradas = useMemo(() => {
    if (!linhas) return null
    if (modoCompleto) {
      if (!filtradasCompletas) return [] // OP inteira ainda carregando
      const de = (pagClienteEf - 1) * TAM_PAGINA_CLIENTE
      return filtradasCompletas.slice(de, de + TAM_PAGINA_CLIENTE)
    }
    if (caixa === '') return linhas
    return linhas.filter((l) => l.celulas['Embalagem'] === caixa) // fallback (OP grande demais): só a página
  }, [linhas, caixa, modoCompleto, filtradasCompletas, pagClienteEf])

  function onBuscar() {
    if (sn.trim() === '' || buscando) return
    startBusca(async () => {
      const r = await buscarHistoricoSN(sn)
      if (r.ok) setRegistros(r.registros)
      else toast.error(r.erro)
    })
  }

  function abrirGrade(opSel: string, pag = 1) {
    const chave = `${pmo}||${opSel}`
    if (opSel !== op) trocarOp(chave)
    setOp(opSel)
    setCaixa('')
    startGrade(async () => {
      const r = await carregarGrade(pmo, opSel, pag)
      if (chaveAtual.current !== chave) return // trocou de OP no meio: descarta a resposta velha
      if (r.ok) {
        setColunas(r.colunas)
        setResumo(r.resumo)
        setLinhas(r.linhas)
        setPagina(r.pagina)
        setTotalPaginas(r.totalPaginas)
        setTotal(r.total)
      } else {
        setLinhas(null); setResumo(null)
        toast.error(r.erro)
      }
    })
  }

  function fmtData(iso: string) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
  }

  // --- duração dos ciclos de Burn-in (entrada/saída) para a linha do tempo do SN ---
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const ciclosBurnin = useMemo(() => {
    const doBurnin = (registros ?? [])
      .filter((r) => r.posto.toLowerCase() === 'burn-in')
      .map((r) => ({ dataHora: r.dataHora, status: r.status }))
    return pareaBurnin(doBurnin)
  }, [registros])

  function duracaoLinha(r: RegistroHistorico): string | null {
    if (r.posto.toLowerCase() !== 'burn-in') return null
    if (r.status.trim() === '') {
      const ciclo = ciclosBurnin.find((c) => c.entrada === r.dataHora)
      if (!ciclo || ciclo.saida !== null) return null
      const min = Math.max(0, Math.round((agora - Date.parse(ciclo.entrada)) / 60000))
      return `há ${formatarDuracao(min)}`
    }
    const ciclo = ciclosBurnin.find((c) => c.saida === r.dataHora)
    return ciclo && ciclo.duracaoMin !== null ? formatarDuracao(ciclo.duracaoMin) : null
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Busca por SN */}
      <Card>
        <CardHeader><CardTitle>Buscar por Nº de Série</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snBusca">Nº de Série</Label>
              <Input id="snBusca" value={sn} onChange={(e) => setSn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBuscar() } }} autoComplete="off" placeholder="Bipe ou digite o SN" />
            </div>
            <Button variant="outline" onClick={onBuscar} disabled={buscando}>
              <Search className="mr-1 size-4" /> {buscando ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>
          {registros !== null && registros.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum registro para esse SN.</p>
          )}
          {registros !== null && registros.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Posto</TableHead>
                    <TableHead>PMO/OP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>Caixa</TableHead>
                    <TableHead>Defeito</TableHead>
                    <TableHead>NQA</TableHead>
                    <TableHead>Integração</TableHead>
                    <TableHead>Reparo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registros.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{fmtData(r.dataHora)}</TableCell>
                      <TableCell>{r.colaborador}</TableCell>
                      <TableCell>{r.posto}</TableCell>
                      <TableCell>{r.pmo}/{r.op}</TableCell>
                      <TableCell className={corCelula(r.status)}>{r.status || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{duracaoLinha(r) ?? '—'}</TableCell>
                      <TableCell>{r.numeroCaixa || '—'}</TableCell>
                      <TableCell>{[r.cod, r.pos, r.tipo].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell>{[r.nqaVisual, r.nqaFuncional].filter(Boolean).join(' / ') || '—'}</TableCell>
                      <TableCell>{r.idIntegracao || '—'}</TableCell>
                      <TableCell>{[r.reparoConserto, r.reparoPosicao].filter(Boolean).join(' · ') || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grade Geral */}
      <Card>
        <CardHeader><CardTitle>Grade Geral</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>Cliente</Label>
              <Select value={cliente} onValueChange={(v) => { setCliente(v ?? ''); setPmo(''); setOp(''); setLinhas(null); setResumo(null); trocarOp('') }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>PMO</Label>
              <Select value={pmo} onValueChange={(v) => { setPmo(v ?? ''); setOp(''); setLinhas(null); setResumo(null); trocarOp('') }} disabled={cliente === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{pmos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>OP</Label>
              <Select value={op} onValueChange={(v) => { if (v) abrirGrade(v) }} disabled={pmo === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Caixa</Label>
              <Select
                value={caixa === '' ? TODAS : caixa}
                onValueChange={(v) => { setCaixa(v === TODAS ? '' : (v ?? '')); setPagCliente(1) }}
                onOpenChange={(o) => { if (o) garantirCompleta() }}
                disabled={op === '' || indisponivel !== undefined}
              >
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODAS}>Todas</SelectItem>
                  {carregandoCompleta ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Carregando…</div>
                  ) : (
                    caixas.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {carregando && <p className="text-sm text-muted-foreground">Carregando grade…</p>}
          {modoCompleto && carregandoCompleta && (
            <p className="text-sm text-muted-foreground">Carregando a OP inteira pra filtrar…</p>
          )}
          {filtroAtivo && (
            <div>
              <Button variant="outline" size="sm" onClick={() => mudarFiltros(FILTROS_VAZIOS)}>
                <FilterX className="mr-1 size-4" /> Limpar filtros de coluna
              </Button>
            </div>
          )}

          {linhasFiltradas && (
            <>
              <Table containerClassName="max-h-[70vh] overflow-auto rounded-lg border border-border">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        Nº de Série
                        <FiltroColuna
                          tipo="texto"
                          coluna="Nº de Série"
                          ativo={filtros.sn.trim() !== ''}
                          onAbrir={garantirCompleta}
                          carregando={carregandoCompleta}
                          indisponivel={indisponivel}
                          erro={erroDaTentativa}
                          texto={filtros.sn}
                          onTexto={(t) => mudarFiltros({ ...filtros, sn: t })}
                        />
                      </div>
                    </TableHead>
                    {colunas.map((p) => (
                      <TableHead key={p}>
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          {p}
                          <FiltroColuna
                            tipo="valores"
                            coluna={p}
                            ativo={filtros.valores[p] !== undefined}
                            onAbrir={garantirCompleta}
                            carregando={carregandoCompleta || (!baseCompleta && erroDaTentativa === undefined)}
                            indisponivel={indisponivel}
                            erro={erroDaTentativa}
                            valores={distintos.get(p) ?? []}
                            selecionados={filtros.valores[p]}
                            onSelecionados={(s) => mudarValoresColuna(p, s)}
                          />
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Resumo por posto (Visão Geral da OP) — sempre a OP inteira, qualquer tamanho */}
                  {resumo && RESUMO_LINHAS.map((lr) => (
                    <TableRow key={lr.rotulo} className={lr.cls}>
                      <TableCell className="font-semibold">{lr.rotulo}</TableCell>
                      {colunas.map((p) => {
                        const rp = resumoPorPosto.get(p)
                        const oculto = p === 'Manutenção' && lr.soProduzido // Manutenção só tem "Produzido"
                        return (
                          <TableCell key={p} className="text-center font-semibold tabular-nums">
                            {rp && !oculto ? lr.get(rp) : '—'}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                  {/* Detalhe por peça (página atual — do servidor, ou do filtro na OP inteira) */}
                  {linhasFiltradas.map((l) => (
                    <TableRow key={l.sn}>
                      <TableCell className="font-medium">{l.sn}</TableCell>
                      {colunas.map((p) => (
                        <TableCell key={p} className={corCelula(l.celulas[p] ?? '')}>{l.celulas[p] ?? '—'}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {modoCompleto ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {filtradasCompletas
                      ? `${filtradasCompletas.length} de ${linhasCompletas?.length ?? total} peça(s)${caixa !== '' ? ` · caixa ${caixa}` : ''} · página ${pagClienteEf} de ${totalPagCliente}`
                      : 'Carregando…'}
                  </span>
                  {totalPagCliente > 1 && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={pagClienteEf <= 1} onClick={() => setPagCliente(pagClienteEf - 1)}>Anterior</Button>
                      <Button variant="outline" size="sm" disabled={pagClienteEf >= totalPagCliente} onClick={() => setPagCliente(pagClienteEf + 1)}>Próxima</Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {total} peça(s){caixa !== '' ? ` · caixa ${caixa} (só nesta página)` : ''} · página {pagina} de {totalPaginas}
                  </span>
                  {totalPaginas > 1 && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={pagina <= 1 || carregando} onClick={() => abrirGrade(op, pagina - 1)}>Anterior</Button>
                      <Button variant="outline" size="sm" disabled={pagina >= totalPaginas || carregando} onClick={() => abrirGrade(op, pagina + 1)}>Próxima</Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
