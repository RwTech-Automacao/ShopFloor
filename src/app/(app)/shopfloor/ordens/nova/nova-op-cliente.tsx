'use client'

import { useId, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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

  // Trocar de PMO antes da resposta chegar: a resposta antiga é descartada.
  const pedido = useRef(0)

  function digitarBusca(valor: string) {
    setBusca(valor)
    if (pmo !== null && valor.trim().toUpperCase() !== pmo) {
      // outra busca: o que era da PMO anterior (trechos, OP escolhida, resposta em voo) não vale mais
      pedido.current++
      setPmo(null); setModo(null); setAnterior(null); setErroUltima(false); setCarregando(false)
      setOpEscolhida(null); setTrechos([])
    }
  }

  async function escolherPmo(codigo: string, m: 'compels' | 'manual') {
    if (codigo === pmo && m === modo) return // o mesmo PMO de novo não apaga o que já foi editado
    setPmo(codigo); setModo(m); setOpEscolhida(null); setTrechos([]); setCarregando(true); setErroUltima(false)
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
    setOpEscolhida(o.numero)
    setOp(String(o.numero)); setQtd(String(o.quantidade))
    if (!anterior?.cliente) setCliente(o.cliente)
    if (!anterior?.descricao) setDescricao(o.descricao)
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
      router.push('/shopfloor/ordens')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <Label htmlFor="busca-pmo">PMO *</Label>
        <Input id="busca-pmo" value={busca} autoComplete="off" onChange={(e) => digitarBusca(e.target.value)} placeholder="Digite a PMO" />
        <p className="text-xs text-muted-foreground">
          {leitura ? `Última leitura do Compels: ${dataHora(leitura)}` : 'O espelho do Compels ainda não foi lido.'}
        </p>
        <div className="flex flex-col gap-1">
          {!escolhida && achadas.map((p) => (
            <Button key={p.pmo} type="button" variant="outline" className="justify-start" onClick={() => { setBusca(p.pmo); void escolherPmo(p.pmo, 'compels') }}>
              {rotuloPmo(p)}
            </Button>
          ))}
          {termo !== '' && !exata && !escolhida && (
            <Button type="button" variant="ghost" className="justify-start" onClick={() => void escolherPmo(termo, 'manual')}>
              {`Usar ${termo} (cadastro manual)`}
            </Button>
          )}
        </div>
        {carregando && <p className="text-sm text-muted-foreground" role="status">Carregando…</p>}
        {modo === 'manual' && <p className="text-sm text-amber-700 dark:text-amber-500">Não está no Compels — cadastro manual</p>}
      </section>

      {modo === 'compels' && pmo && !carregando && (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">OP aberta de {pmo}</p>
          <div className="flex flex-col gap-1">
            {opsDaPmo(espelho, pmo).map((o) => (
              <Button key={o.numero} type="button" variant={opEscolhida === o.numero ? 'default' : 'outline'} className="justify-start"
                onClick={() => escolherOp(o)}>
                {`OP ${o.numero} · ${o.quantidade} un · ${o.cliente || '—'} · ${o.dataDocumento ?? '—'} · ${o.situacao}`}
              </Button>
            ))}
          </div>
        </section>
      )}

      {trechos.length > 0 && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="descricao">Descrição</Label>
              <Input id="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acp">ACP</Label>
              <Input id="acp" value={acp} onChange={(e) => setAcp(e.target.value)} />
            </div>
            <label className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
              <input type="checkbox" checked={embalagemIndividual} onChange={(e) => setEmbalagemIndividual(e.target.checked)} className="mt-0.5 size-4" />
              <span>Embalagem <b>individual</b> — 1 produto por caixa (deixe desmarcado para caixa coletiva).</span>
            </label>
          </section>

          <p className="text-xs text-muted-foreground">
            {anterior ? `Postos copiados da OP ${anterior.op} — confira.`
              : erroUltima ? 'Não foi possível ler a última OP desta PMO — monte os postos.'
              : 'Primeira OP desta PMO: monte os postos de cada trecho.'}
          </p>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {trechos.map((t, ti) => {
              const fixo = t.tipo === 'pmo' ? almox : null
              return (
                <section key={t.seq} aria-labelledby={`${idBase}-t${t.seq}`} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <div>
                    <h3 id={`${idBase}-t${t.seq}`} className="text-sm font-semibold">{rotuloTrecho(t)}</h3>
                    {t.compelsOp && <p className="text-xs text-muted-foreground">{`${t.quantidade ?? '—'} un · ${t.situacao || '—'}`}</p>}
                  </div>
                  <ol className="flex flex-col gap-1">
                    {t.postos.map((p, i) => (
                      <li key={p} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm">
                        <span className="flex-1">{p}</span>
                        {p !== fixo && (
                          <>
                            {ti > 0 && i === 0 && (
                              <button type="button" aria-label={`Mover ${p} para o trecho anterior`} className="text-muted-foreground hover:text-foreground"
                                onClick={() => setTrechos((ts) => moverPostoEntreTrechos(ts, t.seq, p, -1, almox))}><ArrowLeft className="size-4" /></button>
                            )}
                            {ti < trechos.length - 1 && i === t.postos.length - 1 && (
                              <button type="button" aria-label={`Mover ${p} para o trecho seguinte`} className="text-muted-foreground hover:text-foreground"
                                onClick={() => setTrechos((ts) => moverPostoEntreTrechos(ts, t.seq, p, 1, almox))}><ArrowRight className="size-4" /></button>
                            )}
                            <button type="button" aria-label={`Subir ${p}`} className="text-muted-foreground hover:text-foreground" disabled={i === 0}
                              onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: moverPostoNaRota(x.postos, i, -1, fixo) }))}><ArrowUp className="size-4" /></button>
                            <button type="button" aria-label={`Descer ${p}`} className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                              disabled={i === t.postos.length - 1 || t.postos[i + 1] === fixo}
                              onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: moverPostoNaRota(x.postos, i, 1, fixo) }))}><ArrowDown className="size-4" /></button>
                            <button type="button" aria-label={`Remover ${p}`} className="text-muted-foreground hover:text-red-600"
                              onClick={() => mudarTrecho(t.seq, (x) => ({ ...x, postos: x.postos.filter((y) => y !== p) }))}><X className="size-4" /></button>
                          </>
                        )}
                      </li>
                    ))}
                    {t.postos.length === 0 && (
                      <li className="rounded-md border border-dashed border-border px-2 py-2 text-center text-xs text-muted-foreground">Nenhum posto neste trecho.</li>
                    )}
                  </ol>
                  {disponiveis.length > 0 && (
                    <Select value="" onValueChange={(p) => p && mudarTrecho(t.seq, (x) => ({ ...x, postos: [...x.postos, p] }))}>
                      <SelectTrigger className="h-8 text-xs" aria-label={`Adicionar posto em ${rotuloTrecho(t)}`}><SelectValue placeholder="+ Adicionar posto" /></SelectTrigger>
                      <SelectContent>{disponiveis.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {t.tipo === 'prt' && (
                    <div className="flex flex-col gap-1 text-sm">
                      {(['mesmo', 'proprio'] as SnModo[]).map((modoSn) => (
                        <label key={modoSn} className="flex items-center gap-2">
                          <input type="radio" name={`sn_modo_${t.seq}`} checked={t.snModo === modoSn}
                            onChange={() => mudarTrecho(t.seq, (x) => ({ ...x, snModo: modoSn, faixas: modoSn === 'proprio' ? [{ sn_ini: '', sn_fim: '' }] : [] }))} />
                          {modoSn === 'mesmo' ? 'Mesma série da PMO' : 'Série própria'}
                        </label>
                      ))}
                    </div>
                  )}
                  {(t.tipo === 'pmo' || t.snModo === 'proprio') && (
                    <FaixasSn faixas={t.faixas} idBase={t.tipo === 'pmo' ? '' : `t${t.seq}_`}
                      setFaixas={(f: FaixaSN[]) => mudarTrecho(t.seq, (x) => ({ ...x, faixas: f }))}
                      qtd={t.tipo === 'pmo' ? qtd : String(t.quantidade ?? '')} nPainel={t.tipo === 'pmo' ? nPainel : 1} />
                  )}
                </section>
              )
            })}
          </section>

          <div className="flex justify-end">
            <Button type="button" onClick={salvar} disabled={salvando || !!erroOp} className="bg-enterplak hover:bg-enterplak-700">
              {salvando ? 'Salvando…' : 'Salvar OP'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
