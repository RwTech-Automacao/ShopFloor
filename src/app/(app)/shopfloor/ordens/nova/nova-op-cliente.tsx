'use client'

import { useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cadastrarOpAction, ultimaOpDaPmoAction } from '@/modules/shopfloor/application/cadastro-op-actions'
import {
  distribuirPostos, erroSufixoOp, fixarAlmoxarifado, moverPostoEntreTrechos, opsDaPmo, pmosDoEspelho, rotuloPmo,
  trechoManual, trechosDoEspelho, ultimaLeitura, validarCadastro,
  type CadastroOp, type OpEspelho, type TrechoCadastro, type UltimaOp,
} from '@/modules/shopfloor/domain/cadastro-op'
import { postoAlmoxarifadoPadrao } from '@/modules/shopfloor/domain/rota-op-nova'
import { PERFIL_PADRAO, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { BarraFixa, CamposQuantidade, CorrenteTrechos, ResumoRota, nPainelDe, paineisFecham } from '../corrente-trechos'

const TOAST = { position: 'bottom-center' as const }
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
/** '2026-11-10' → '10/11/2026' sem passar por Date (que trocaria o dia pelo fuso). */
const dataCurta = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

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
  const [dadosOk, setDadosOk] = useState(false)
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
  const nPainel = nPainelDe(placasPorPainel)
  const baseOp = trechos.at(-1)?.compelsOp ?? ''
  const erroOp = modo === 'compels' && trechos.length > 0 ? erroSufixoOp(baseOp, op) : null
  const dadosValidos = op.trim() !== '' && !erroOp && cliente.trim() !== '' && paineisFecham(qtd, nPainel)
  const passo3Fechado = dadosOk && dadosValidos
  const usados = new Set(trechos.flatMap((t) => t.postos))
  const disponiveis = postos.filter((p) => !usados.has(p))
  const opsAbertas = modo === 'compels' && pmo ? opsDaPmo(espelho, pmo) : []
  const opAtual = opsAbertas.find((o) => o.numero === opEscolhida) ?? null

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
      setOpEscolhida(null); setTrocandoOp(false); setTrechos([]); setDadosOk(false)
    }
  }

  async function escolherPmo(codigo: string, m: 'compels' | 'manual') {
    setTrocandoPmo(false)
    focoPendente.current = 'trocar-pmo'
    if (codigo === pmo && m === modo) return // o mesmo PMO de novo não apaga o que já foi editado
    setPmo(codigo); setModo(m); setOpEscolhida(null); setTrocandoOp(false); setTrechos([]); setDadosOk(false); setCarregando(true); setErroUltima(false)
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
    setTrocandoOp(false); setDadosOk(false)
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
      <Passo id={`${idBase}-p3`} n={3} titulo="Dados da OP"
        estado={passo3Fechado ? 'feito' : trechos.length > 0 ? 'ativo' : 'pendente'}
        resumo={trechos.length === 0
          ? <p className="text-xs text-muted-foreground">{aguardando}</p>
          : passo3Fechado && (
            <p className="truncate text-sm font-medium text-foreground">
              {[`OP ${op.trim()}`, cliente.trim(), qtd.trim() !== '' ? `${qtd.trim()} un` : null,
                nPainel > 1 ? `${nPainel} placas por painel` : null,
                embalagemIndividual ? 'embalagem individual' : 'caixa coletiva'].filter(Boolean).join(' · ')}
            </p>
          )}
        acao={passo3Fechado && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDadosOk(false)}>Editar</Button>
        )}>
        {trechos.length > 0 && !passo3Fechado && (
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
            <CamposQuantidade qtd={qtd} setQtd={setQtd} placasPorPainel={placasPorPainel} setPlacasPorPainel={setPlacasPorPainel} />
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
            <div className="flex items-center justify-end gap-3 sm:col-span-2 lg:col-span-3">
              {!dadosValidos && <p className="text-xs text-muted-foreground">Preencha o Nº da OP e o cliente para confirmar.</p>}
              <Button type="button" variant="outline" size="sm" disabled={!dadosValidos} onClick={() => setDadosOk(true)}>
                Confirmar dados
              </Button>
            </div>
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
          <CorrenteTrechos trechos={trechos} almox={almox} idBase={idBase} qtd={qtd} nPainel={nPainel}
            mudarTrecho={mudarTrecho} opcoesAdicionar={() => disponiveis}
            moverEntreTrechos={(seq, p, delta) => setTrechos((ts) => moverPostoEntreTrechos(ts, seq, p, delta, almox))} />
        )}
      </Passo>

      {/* Barra fixa: resumo da rota e as ações */}
      <BarraFixa resumo={trechos.length > 0 ? <ResumoRota trechos={trechos} /> : 'Escolha a PMO e a OP para montar a rota.'}>
        <Link href="/shopfloor/ordens-nova" className={buttonVariants({ variant: 'ghost' })}>Cancelar</Link>
        <Button type="button" onClick={salvar} disabled={salvando || !!erroOp || trechos.length === 0} className="bg-enterplak hover:bg-enterplak-700">
          {salvando ? 'Salvando…' : 'Salvar OP'}
        </Button>
      </BarraFixa>
    </div>
  )
}
