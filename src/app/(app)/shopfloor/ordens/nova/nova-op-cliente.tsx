'use client'

import { Fragment, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { placasDosPaineis, paineisDasPlacas } from '@/modules/shopfloor/domain/placas-por-painel'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cadastrarOpAction, ultimaOpDaPmoAction } from '@/modules/shopfloor/application/cadastro-op-actions'
import {
  distribuirPostos, erroSufixoOp, fixarAlmoxarifado, moverPostoEntreTrechos, opsDaPmo, pmosDoEspelho, rotuloPmo, rotuloTrecho,
  trechoManual, trechosDoEspelho, ultimaLeitura, validarCadastro,
  type CadastroOp, type OpEspelho, type SnModo, type TrechoCadastro, type UltimaOp,
} from '@/modules/shopfloor/domain/cadastro-op'
import { moverPostoNaRota, postoAlmoxarifadoPadrao } from '@/modules/shopfloor/domain/rota-op-nova'
import { PERFIL_PADRAO, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import type { FaixaSN } from '@/modules/shopfloor/domain/faixas-sn'
import { FaixasSn } from '../ordem-form'

const TOAST = { position: 'bottom-center' as const }
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
/** '2026-11-10' → '10/11/2026' sem passar por Date (que trocaria o dia pelo fuso). */
const dataCurta = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

const ICONE = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40'

type EstadoPasso = 'pendente' | 'ativo' | 'feito'

/** Um passo da sequência: número, título e, quando concluído, uma linha de resumo com o botão Trocar. */
function Passo({ id, n, titulo, estado, resumo, acao, children }: {
  id: string
  n: number
  titulo: string
  estado: EstadoPasso
  resumo?: ReactNode
  acao?: ReactNode
  children?: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <span aria-hidden className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
          estado === 'feito' ? 'bg-enterplak text-white'
            : estado === 'ativo' ? 'border-2 border-enterplak text-enterplak'
            : 'border border-border text-muted-foreground',
        )}>{n}</span>
        <div className="min-w-0 flex-1">
          <h3 id={id} className={cn(
            estado === 'feito' && resumo ? 'text-xs font-medium text-muted-foreground' : 'text-sm font-semibold',
            estado === 'pendente' ? 'text-muted-foreground' : estado === 'ativo' && 'text-foreground',
          )}>
            <span className="sr-only">{`Passo ${n}: `}</span>{titulo}
          </h3>
          {resumo}
        </div>
        {acao}
      </div>
      {children && <div className="border-t border-border px-4 py-4">{children}</div>}
    </section>
  )
}

export function NovaOpCliente({ espelho, postos, postosPerfil, clientesExistentes }: {
  espelho: OpEspelho[]
  postos: string[]
  postosPerfil: Record<string, PerfilPosto>
  clientesExistentes: string[]
}) {
  const router = useRouter()
  const [salvando, startSalvar] = useTransition()
  const almox = postoAlmoxarifadoPadrao(postos, (p) => postosPerfil[p] ?? PERFIL_PADRAO)
  const pmos = useMemo(() => pmosDoEspelho(espelho), [espelho])
  const leitura = ultimaLeitura(espelho)

  const [busca, setBusca] = useState('')
  const [pmo, setPmo] = useState<string | null>(null)
  const [modo, setModo] = useState<'compels' | 'manual' | null>(null)
  const [anterior, setAnterior] = useState<UltimaOp | null>(null)
  // A lista de OPs só aparece depois da última OP da PMO chegar: escolher a OP antes copiaria postos vazios.
  const [carregando, setCarregando] = useState(false)
  const [erroUltima, setErroUltima] = useState(false)
  const idBase = useId()
  const [opEscolhida, setOpEscolhida] = useState<number | null>(null)
  // Passo concluído vira resumo; "Trocar" reabre só aquele passo.
  const [trocandoPmo, setTrocandoPmo] = useState(false)
  const [trocandoOp, setTrocandoOp] = useState(false)
  const [trechos, setTrechos] = useState<TrechoCadastro[]>([])
  const [op, setOp] = useState('')
  const [cliente, setCliente] = useState('')
  const [descricao, setDescricao] = useState('')
  const [qtd, setQtd] = useState('')
  const [acp, setAcp] = useState('')
  const [placasPorPainel, setPlacasPorPainel] = useState('1')
  const [embalagemIndividual, setEmbalagemIndividual] = useState(false)

  const termo = busca.trim().toUpperCase()
  const achadas = termo === '' ? [] : pmos.filter((p) => p.pmo.toUpperCase().includes(termo)).slice(0, 8)
  const escolhida = pmo !== null && termo === pmo
  const exata = pmos.some((p) => p.pmo.toUpperCase() === termo)
  const nPainel = Number.isInteger(Number(placasPorPainel)) && Number(placasPorPainel) >= 1 ? Number(placasPorPainel) : 1
  const baseOp = trechos.at(-1)?.compelsOp ?? ''
  const erroOp = modo === 'compels' && trechos.length > 0 ? erroSufixoOp(baseOp, op) : null
  const usados = new Set(trechos.flatMap((t) => t.postos))
  const disponiveis = postos.filter((p) => !usados.has(p))
  const opsAbertas = modo === 'compels' && pmo ? opsDaPmo(espelho, pmo) : []
  const opAtual = opsAbertas.find((o) => o.numero === opEscolhida) ?? null
  const totalPostos = trechos.reduce((a, t) => a + t.postos.length, 0)
  // Número de cada posto na rota inteira: a contagem continua de um trecho para o outro.
  const inicioDoTrecho = trechos.map((_, i) => trechos.slice(0, i).reduce((a, t) => a + t.postos.length, 0))

  const pmoFeita = pmo !== null && !trocandoPmo
  const opFeita = modo === 'manual' || (opEscolhida !== null && !trocandoOp && !carregando)
  const listarOps = modo === 'compels' && pmo !== null && !carregando && (opEscolhida === null || trocandoOp)

  // Trocar de PMO antes da resposta chegar: a resposta antiga é descartada.
  const pedido = useRef(0)

  // O botão clicado some quando o passo fecha ou abre: o foco vai para o controle que toma o lugar dele.
  const focoPendente = useRef<string | null>(null)
  const focar = (chave: string) => (el: HTMLElement | null) => {
    if (!el || focoPendente.current !== chave) return
    focoPendente.current = null
    el.focus()
    if (el instanceof HTMLInputElement) el.select()
  }

  function digitarBusca(valor: string) {
    setBusca(valor)
    if (pmo !== null && valor.trim().toUpperCase() !== pmo) {
      // outra busca: o que era da PMO anterior (trechos, OP escolhida, resposta em voo) não vale mais
      pedido.current++
      setPmo(null); setModo(null); setAnterior(null); setErroUltima(false); setCarregando(false)
      setOpEscolhida(null); setTrocandoOp(false); setTrechos([])
    }
  }

  async function escolherPmo(codigo: string, m: 'compels' | 'manual') {
    setTrocandoPmo(false)
    focoPendente.current = 'trocar-pmo'
    if (codigo === pmo && m === modo) return // o mesmo PMO de novo não apaga o que já foi editado
    setPmo(codigo); setModo(m); setOpEscolhida(null); setTrocandoOp(false); setTrechos([]); setCarregando(true); setErroUltima(false)
    const meu = ++pedido.current
    let ultima: UltimaOp | null = null
    let falhou = false
    try {
      const r = await ultimaOpDaPmoAction(codigo)
      if (r.ok) ultima = r.ultima
      else { falhou = true; toast.error(r.erro, TOAST) }
    } catch { falhou = true; toast.error('Não foi possível ler a última OP desta PMO.', TOAST) }
    if (meu !== pedido.current) return
    setAnterior(ultima)
    setErroUltima(falhou)
    setCarregando(false)
    setCliente(ultima?.cliente ?? ''); setDescricao(ultima?.descricao ?? '')
    setPlacasPorPainel(String(ultima?.placasPorPainel ?? 1)); setEmbalagemIndividual(ultima?.embalagemIndividual ?? false)
    setOp(''); setQtd(''); setAcp('')
    if (m === 'manual') setTrechos(distribuirPostos([trechoManual(codigo)], ultima?.postos ?? [], almox))
  }

  function escolherOp(o: OpEspelho) {
    setTrocandoOp(false)
    focoPendente.current = 'trocar-op'
    if (o.numero === opEscolhida) return // a mesma OP de novo não apaga o que já foi editado
    setOpEscolhida(o.numero)
    setOp(String(o.numero)); setQtd(String(o.quantidade))
    // cliente e descrição vêm sempre do Compels (padronizar); o resto continua copiado da última OP
    setCliente(o.cliente); setDescricao(o.descricao)
    setTrechos(distribuirPostos(trechosDoEspelho(o, espelho), anterior?.postos ?? [], almox))
  }

  const mudarTrecho = (seq: number, f: (t: TrechoCadastro) => TrechoCadastro) =>
    setTrechos((ts) => fixarAlmoxarifado(ts.map((t) => (t.seq === seq ? f(t) : t)), almox))

  function salvar() {
    if (!pmo || !modo) return
    const c: CadastroOp = {
      modo, pmo, op: op.trim(), cliente: cliente.trim(), descricao: descricao.trim(),
      qtd: qtd.trim() === '' || Number.isNaN(Number(qtd)) ? null : Number(qtd), acp: acp.trim(),
      embalagemIndividual, placasPorPainel: Number(placasPorPainel), trechos,
      componentes: anterior?.componentes ?? [], burnin: anterior?.burnin ?? [],
    }
    const v = validarCadastro(c)
    if (!v.ok) { toast.error(v.erro, TOAST); return }
    startSalvar(async () => {
      const r = await cadastrarOpAction(c)
      if (!r.ok) { toast.error(r.erro, TOAST); return }
      toast.success('OP criada', { ...TOAST, description: `${r.pmo}/${r.op}` })
      router.push('/shopfloor/ordens-nova')
    })
  }

  const aguardando = pmo === null ? 'Escolha a PMO primeiro.'
    : carregando || modo === 'manual' ? 'Aguarde a leitura da última OP desta PMO.' : 'Escolha a OP primeiro.'
  const descricaoPmo = pmo ? pmos.find((p) => p.pmo === pmo)?.descricao : undefined
  const linhaResumo = 'truncate text-sm font-medium text-foreground'
  const opcao = 'flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {leitura ? `Última leitura do Compels: ${dataHora(leitura)}` : 'O espelho do Compels ainda não foi lido.'}
      </p>

      {/* 1 · PMO */}
      <Passo id={`${idBase}-p1`} n={1} titulo="PMO" estado={pmoFeita ? 'feito' : 'ativo'}
        resumo={pmoFeita && (
          <p className={linhaResumo} title={descricaoPmo ? `${pmo} — ${descricaoPmo}` : pmo!}>
            {descricaoPmo ? `${pmo} — ${descricaoPmo}` : pmo}
          </p>
        )}
        acao={pmoFeita && (
          <Button ref={focar('trocar-pmo')} type="button" variant="outline" size="sm" aria-label="Trocar PMO"
            onClick={() => { focoPendente.current = 'busca'; setTrocandoPmo(true) }}>
            Trocar
          </Button>
        )}>
        {!pmoFeita && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="busca-pmo">PMO *</Label>
            <Input id="busca-pmo" ref={focar('busca')} value={busca} autoComplete="off" onChange={(e) => digitarBusca(e.target.value)}
              placeholder="Digite o código, ex.: PMOC14" aria-describedby="busca-pmo-ajuda" />
            <p id="busca-pmo-ajuda" className="text-xs text-muted-foreground">
              {termo === '' ? 'Digite parte do código para ver as PMOs com OP aberta no Compels.'
                : achadas.length === 0 ? 'Nenhuma PMO com OP aberta no Compels tem esse código. Se ela não estiver lá, use o cadastro manual.'
                : 'Escolha a PMO na lista.'}
            </p>
            {(achadas.length > 0 || (termo !== '' && !exata)) && (
              <div className="flex flex-col gap-1">
                {achadas.map((p) => (
                  <button key={p.pmo} type="button" aria-pressed={escolhida && p.pmo === pmo}
                    className={cn(opcao, escolhida && p.pmo === pmo ? 'border-enterplak bg-enterplak-50' : 'border-border hover:bg-muted')}
                    onClick={() => { setBusca(p.pmo); void escolherPmo(p.pmo, 'compels') }}>
                    {rotuloPmo(p)}
                  </button>
                ))}
                {termo !== '' && !exata && (
                  <Button type="button" variant="ghost" className="justify-start" onClick={() => void escolherPmo(termo, 'manual')}>
                    {`Usar ${termo} (cadastro manual)`}
                  </Button>
                )}
              </div>
            )}
            {pmo !== null && (
              <div>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setBusca(pmo); focoPendente.current = 'trocar-pmo'; setTrocandoPmo(false) }}>
                  {`Manter ${pmo}`}
                </Button>
              </div>
            )}
          </div>
        )}
      </Passo>

      {/* 2 · OP do Compels */}
      <Passo id={`${idBase}-p2`} n={2} titulo="OP do Compels"
        estado={pmo === null ? 'pendente' : opFeita ? 'feito' : 'ativo'}
        resumo={
          pmo === null ? <p className="text-xs text-muted-foreground">Escolha a PMO primeiro.</p>
          : modo === 'manual' ? (
            <>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-500">Não está no Compels — cadastro manual</p>
              <p className="text-xs text-muted-foreground">Preencha os dados da OP e monte a rota abaixo.</p>
            </>
          )
          : opFeita && opAtual ? (
            <>
              <p className={linhaResumo}>{`OP ${opAtual.numero} · ${opAtual.quantidade} un · ${opAtual.situacao}`}</p>
              <p className="truncate text-xs text-muted-foreground">{`${opAtual.cliente || 'Sem cliente'} · ${dataCurta(opAtual.dataDocumento)}`}</p>
            </>
          ) : null
        }
        acao={modo === 'compels' && opFeita && opAtual && (
          <Button ref={focar('trocar-op')} type="button" variant="outline" size="sm" aria-label="Trocar OP"
            onClick={() => { focoPendente.current = 'lista-op'; setTrocandoOp(true) }}>
            Trocar
          </Button>
        )}>
        {carregando ? <p className="text-sm text-muted-foreground" role="status">Carregando…</p> : listarOps ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {opsAbertas.length === 0 ? `Nenhuma OP aberta de ${pmo} no Compels.` : `Escolha a OP aberta de ${pmo}.`}
            </p>
            <div className="flex flex-col gap-1">
              {opsAbertas.map((o) => {
                const atual = opEscolhida === o.numero
                return (
                  <button key={o.numero} ref={atual ? focar('lista-op') : undefined} type="button" aria-pressed={atual} onClick={() => escolherOp(o)}
                    className={cn(opcao, atual ? 'border-enterplak bg-enterplak-50' : 'border-border hover:bg-muted')}>
                    <span className="font-semibold text-foreground">{`OP ${o.numero}`}</span>
                    <span className="tabular-nums">{`${o.quantidade} un`}</span>
                    <span className="text-muted-foreground">{`${o.cliente || 'Sem cliente'} · ${dataCurta(o.dataDocumento)} · ${o.situacao}`}</span>
                  </button>
                )
              })}
            </div>
            {opEscolhida !== null && (
              <div>
                <Button type="button" variant="ghost" size="sm" onClick={() => { focoPendente.current = 'trocar-op'; setTrocandoOp(false) }}>
                  {`Manter OP ${opEscolhida}`}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </Passo>

      {/* 3 · Dados da OP */}
      <Passo id={`${idBase}-p3`} n={3} titulo="Dados da OP" estado={trechos.length > 0 ? 'ativo' : 'pendente'}
        resumo={trechos.length === 0 && <p className="text-xs text-muted-foreground">{aguardando}</p>}>
        {trechos.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="op">Nº OP *</Label>
              <Input id="op" value={op} onChange={(e) => setOp(e.target.value)} aria-invalid={erroOp ? true : undefined} aria-describedby="op-ajuda" />
              <p id="op-ajuda" className={erroOp ? 'text-xs text-red-600' : 'text-xs text-muted-foreground'}>
                {erroOp ?? (modo === 'compels' && opEscolhida !== null ? `Pode acrescentar sufixo: ${opEscolhida}_F` : '')}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cliente">Cliente *</Label>
              <Input id="cliente" list="clientes-existentes" value={cliente} onChange={(e) => setCliente(e.target.value)} />
              <datalist id="clientes-existentes">{clientesExistentes.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qtd">Quantidade</Label>
              <Input id="qtd" inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="placas_por_painel">Placas por painel</Label>
              <Input id="placas_por_painel" inputMode="numeric" value={placasPorPainel} onChange={(e) => setPlacasPorPainel(e.target.value)} />
              <p className="text-xs text-muted-foreground">Use quando a etiqueta é por painel: cada bipe conta como N placas.</p>
            </div>
            {nPainel > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="paineis">Painéis</Label>
                <Input
                  id="paineis" inputMode="numeric"
                  value={qtd.trim() === '' ? '' : String(paineisDasPlacas(Number(qtd), nPainel) ?? '')}
                  onChange={(e) => setQtd(e.target.value.trim() === '' || Number.isNaN(Number(e.target.value)) ? '' : String(placasDosPaineis(Number(e.target.value), nPainel)))}
                />
                {qtd.trim() !== '' && paineisDasPlacas(Number(qtd), nPainel) === null && (
                  <p className="text-xs text-destructive">{qtd} placas não fecham em painéis de {nPainel}. Ajuste a quantidade ou os painéis.</p>
                )}
                <p className="text-xs text-muted-foreground">A faixa de SN conta painéis (um SN por painel).</p>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="descricao">Descrição</Label>
              <Input id="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acp">ACP</Label>
              <Input id="acp" value={acp} onChange={(e) => setAcp(e.target.value)} />
            </div>
            <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
              <input type="checkbox" checked={embalagemIndividual} onChange={(e) => setEmbalagemIndividual(e.target.checked)} className="mt-0.5 size-4 accent-enterplak" />
              <span>Embalagem <b>individual</b> — 1 produto por caixa (deixe desmarcado para caixa coletiva).</span>
            </label>
          </div>
        )}
      </Passo>

      {/* 4 · Rota e faixas */}
      <Passo id={`${idBase}-p4`} n={4} titulo="Rota e faixas" estado={trechos.length > 0 ? 'ativo' : 'pendente'}
        resumo={trechos.length === 0
          ? <p className="text-xs text-muted-foreground">{aguardando}</p>
          : (
            <p className="text-xs text-muted-foreground">
              {anterior ? `Postos copiados da OP ${anterior.op} — confira.`
                : erroUltima ? 'Não foi possível ler a última OP desta PMO — monte os postos.'
                : 'Primeira OP desta PMO: monte os postos de cada trecho.'}
            </p>
          )}>
        {trechos.length > 0 && (
          <div className="flex flex-col gap-1 lg:flex-row lg:items-stretch lg:gap-0 lg:overflow-x-auto lg:pb-1">
            {trechos.map((t, ti) => {
              const fixo = t.tipo === 'pmo' ? almox : null
              const inicio = inicioDoTrecho[ti]!
              return (
                <Fragment key={t.seq}>
                  {ti > 0 && (
                    <div aria-hidden className="flex shrink-0 items-center justify-center text-muted-foreground lg:w-6">
                      <ChevronDown className="size-5 lg:hidden" />
                      <ChevronRight className="hidden size-5 lg:block" />
                    </div>
                  )}
                  <section aria-labelledby={`${idBase}-t${t.seq}`}
                    className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-3 lg:flex-[1_0_14rem]">
                    <header className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <h4 id={`${idBase}-t${t.seq}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{rotuloTrecho(t)}</h4>
                        <Badge variant={t.tipo === 'pmo' ? 'default' : 'secondary'}>{t.tipo === 'pmo' ? 'PMO' : 'PRT'}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[t.compelsOp && `${t.quantidade ?? '—'} un · ${t.situacao || '—'}`, plural(t.postos.length, 'posto', 'postos')].filter(Boolean).join(' · ')}
                      </p>
                    </header>
                    {t.postos.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                        Nenhum posto neste trecho. Traga postos com ← → ou adicione um.
                      </p>
                    ) : (
                      <ol className="flex flex-col gap-1">
                        {t.postos.map((p, i) => (
                          <li key={p} className="flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border border-border bg-background py-1 pr-1 pl-2 text-sm">
                            <span className="w-6 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{inicio + i + 1}</span>
                            <span className="min-w-0 flex-1 basis-20 break-words">{p}</span>
                            {p !== fixo && (
                              <span className="ml-auto flex items-center">
                                {ti > 0 && i === 0 && (
                                  <button type="button" aria-label={`Mover ${p} para o trecho anterior`} className={ICONE}
                                    onClick={() => setTrechos((ts) => moverPostoEntreTrechos(ts, t.seq, p, -1, almox))}><ArrowLeft className="size-4" /></button>
                                )}
                                {ti < trechos.length - 1 && i === t.postos.length - 1 && (
                                  <button type="button" aria-label={`Mover ${p} para o trecho seguinte`} className={ICONE}
                                    onClick={() => setTrechos((ts) => moverPostoEntreTrechos(ts, t.seq, p, 1, almox))}><ArrowRight className="size-4" /></button>
                                )}
                                <button type="button" aria-label={`Subir ${p}`} className={ICONE} disabled={i === 0}
                                  onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: moverPostoNaRota(x.postos, i, -1, fixo) }))}><ArrowUp className="size-4" /></button>
                                <button type="button" aria-label={`Descer ${p}`} className={ICONE}
                                  disabled={i === t.postos.length - 1 || t.postos[i + 1] === fixo}
                                  onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: moverPostoNaRota(x.postos, i, 1, fixo) }))}><ArrowDown className="size-4" /></button>
                                <button type="button" aria-label={`Remover ${p}`} className={cn(ICONE, 'hover:text-red-600')}
                                  onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: x.postos.filter((y) => y !== p) }))}><X className="size-4" /></button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                    {disponiveis.length > 0 && (
                      <Select value="" onValueChange={(p) => p && mudarTrecho(t.seq, (x) => ({ ...x, postos: [...x.postos, p] }))}>
                        <SelectTrigger className="h-8 text-xs" aria-label={`Adicionar posto em ${rotuloTrecho(t)}`}><SelectValue placeholder="Adicionar posto" /></SelectTrigger>
                        <SelectContent>{disponiveis.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    {t.tipo === 'prt' && (
                      <fieldset className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-sm">
                        <legend className="sr-only">{`Série de ${rotuloTrecho(t)}`}</legend>
                        {(['mesmo', 'proprio'] as SnModo[]).map((modoSn) => (
                          <label key={modoSn} className="flex items-center gap-2">
                            <input type="radio" name={`sn_modo_${t.seq}`} checked={t.snModo === modoSn} className="size-4 accent-enterplak"
                              onChange={() => mudarTrecho(t.seq, (x) => ({ ...x, snModo: modoSn, faixas: modoSn === 'proprio' ? [{ sn_ini: '', sn_fim: '' }] : [] }))} />
                            {modoSn === 'mesmo' ? 'Mesma série da PMO' : 'Série própria'}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {(t.tipo === 'pmo' || t.snModo === 'proprio') && (
                      <div className={cn('flex flex-col gap-2', t.tipo === 'pmo' && 'mt-auto border-t border-border pt-3')}>
                        <p className="text-xs font-medium text-muted-foreground">Faixas de série</p>
                        <FaixasSn faixas={t.faixas} idBase={t.tipo === 'pmo' ? '' : `t${t.seq}_`}
                          setFaixas={(f: FaixaSN[]) => mudarTrecho(t.seq, (x) => ({ ...x, faixas: f }))}
                          qtd={t.tipo === 'pmo' ? qtd : String(t.quantidade ?? '')} nPainel={t.tipo === 'pmo' ? nPainel : 1} />
                      </div>
                    )}
                  </section>
                </Fragment>
              )
            })}
          </div>
        )}
      </Passo>

      {/* Barra fixa: resumo da rota e as ações */}
      <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-card px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6 lg:-bottom-8 lg:-mx-8 lg:-mb-8 lg:px-8">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground" data-testid="resumo-rota">
          {trechos.length > 0
            ? <><span className="font-medium text-foreground">{plural(trechos.length, 'trecho', 'trechos')}</span>{` · ${plural(totalPostos, 'posto', 'postos')}`}</>
            : 'Escolha a PMO e a OP para montar a rota.'}
        </p>
        <Link href="/shopfloor/ordens-nova" className={buttonVariants({ variant: 'ghost' })}>Cancelar</Link>
        <Button type="button" onClick={salvar} disabled={salvando || !!erroOp || trechos.length === 0} className="bg-enterplak hover:bg-enterplak-700">
          {salvando ? 'Salvando…' : 'Salvar OP'}
        </Button>
      </div>
    </div>
  )
}
