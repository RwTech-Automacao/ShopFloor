'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { previsaoDaSelecao, type PrevisaoNota, type SituacaoNota } from '@/modules/compels/domain/baixa-nf'
import type { ResultadoConfirmacao } from '@/modules/compels/application/baixar-nfs'
import { FILTRO_VAZIO, filtrarNotas, type FiltroNotas, type NotaDaTela } from '@/modules/faturamento/domain/tela'
import type { DadosTelaBaixaNf, LinhaFilaTela } from '@/modules/faturamento/application/carregar-tela'
import { confirmarSelecaoAction, tirarDaFilaAction } from '@/modules/faturamento/application/actions'
import { cn } from '@/lib/utils'

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—'
const reais = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

function Situacao({ s, posicao }: { s: SituacaoNota; posicao: number | null }) {
  if (posicao != null) return <Badge variant="secondary">Na fila nº {posicao}</Badge>
  if (s.tipo === 'pode_baixar') return <Badge className="bg-emerald-100 text-emerald-800">Pode baixar</Badge>
  if (s.tipo === 'manual') {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Badge variant="outline">Baixa manual</Badge>
        <span className="text-xs text-muted-foreground">{s.motivo}</span>
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant="destructive">Sem saldo</Badge>
      <span className="text-xs text-muted-foreground">
        {s.faltas.length > 0 ? s.faltas.map((f) => `${f.codigo}: faltam ${qtd(f.falta)}`).join(' · ') : s.motivo}
      </span>
    </span>
  )
}

const TEXTO_PREVISAO = (p: PrevisaoNota, motivo: string) =>
  p.acao === 'baixa_agora' ? 'baixa agora'
    : p.acao === 'fila' ? `entra na fila na posição ${p.posicao}`
      : p.acao === 'ja_na_fila' ? 'já está na fila'
        : `baixa manual — ${motivo}`

const TEXTO_RESULTADO: Record<ResultadoConfirmacao['resultado'], string> = {
  baixada: 'Baixada',
  simulada: 'Simulação: seria baixada',
  na_fila: 'Na fila',
  manual: 'Baixa manual',
  ja_na_fila: 'Já estava na fila',
  nao_pendente: 'Não está mais pendente',
  erro: 'Erro',
}

export function BaixaNfTela({ dados, podeBaixar }: { dados: DadosTelaBaixaNf; podeBaixar: boolean }) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<FiltroNotas>(FILTRO_VAZIO)
  const [selecao, setSelecao] = useState<number[]>([])
  const [aberto, setAberto] = useState(false)
  const [resultado, setResultado] = useState<ResultadoConfirmacao[] | null>(null)
  const [pendente, iniciar] = useTransition()

  const notas = useMemo(() => filtrarNotas(dados.notas, filtro), [dados.notas, filtro])
  const porId = useMemo(() => new Map(dados.notas.map((n) => [n.id, n])), [dados.notas])
  const estoquePa = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const n of dados.notas) for (const i of n.itens) m.set(i.codigo, i.estoquePa)
    return m
  }, [dados.notas])

  const selecionadas = useMemo(
    () => selecao.map((id) => porId.get(id)).filter((n): n is NotaDaTela => !!n),
    [selecao, porId],
  )
  const previsao = useMemo(
    () => previsaoDaSelecao(
      selecionadas.map((n) => ({ notaId: n.id, situacao: n.situacao, itens: n.itens, naFila: n.posicaoNaFila != null })),
      estoquePa,
      dados.aguardando.length,
    ),
    [selecionadas, estoquePa, dados.aguardando.length],
  )

  const podeConfirmar = podeBaixar && dados.modo !== null && dados.compels === 'ok' && dados.filaOk
  const marcar = (id: number) =>
    setSelecao((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  function confirmar() {
    iniciar(async () => {
      const r = await confirmarSelecaoAction(selecao)
      if (!r.ok) { toast.error(r.erro); return }
      setResultado(r.valor)
      setSelecao([])
      router.refresh()
    })
  }

  function tirar(linha: LinhaFilaTela) {
    iniciar(async () => {
      const r = await tirarDaFilaAction(linha.id)
      if (!r.ok) { toast.error(r.erro); return }
      toast.success(r.valor ? `NF ${linha.numero} saiu da fila.` : `NF ${linha.numero} já não estava na fila.`)
      router.refresh()
    })
  }

  const campo = (k: keyof FiltroNotas) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFiltro((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="flex flex-col gap-4">
      {dados.modo === 'simular' && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Modo simulação: a tela e a fila fazem tudo menos a baixa no Compels (&quot;simulação: seria baixada&quot;).
        </p>
      )}
      {dados.compels === 'indisponivel' && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Compels indisponível: não foi possível ler as notas pendentes. Tente de novo em instantes.
        </p>
      )}
      {dados.compels === 'nao_configurado' && (
        <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">O Compels não está configurado neste ambiente.</p>
      )}
      {!dados.filaOk && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível ler a fila. Nada pode ser confirmado agora.
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input placeholder="Número da nota" value={filtro.numero} onChange={campo('numero')} inputMode="numeric" />
        <Input placeholder="Cliente" value={filtro.cliente} onChange={campo('cliente')} />
        <Input placeholder="Item" value={filtro.item} onChange={campo('item')} />
        <Input type="date" aria-label="Emissão de" value={filtro.de} onChange={campo('de')} />
        <Input type="date" aria-label="Emissão até" value={filtro.ate} onChange={campo('ate')} />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={filtro.soPodeBaixar} onCheckedChange={(v) => setFiltro((f) => ({ ...f, soPodeBaixar: v === true }))} />
          Só as que já podem baixar
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!podeConfirmar || selecao.length === 0 || pendente} onClick={() => { setResultado(null); setAberto(true) }}>
          Baixar selecionadas ({selecao.length})
        </Button>
        {podeBaixar && dados.modo === null && (
          <span className="text-sm text-muted-foreground">A baixa de NF está desligada neste ambiente.</span>
        )}
        <span className="text-sm text-muted-foreground">{notas.length} de {dados.notas.length} nota(s) pendente(s)</span>
      </div>

      <div className="flex flex-col gap-3">
        {notas.map((n) => {
          const ordem = selecao.indexOf(n.id)
          return (
            <div key={n.id} className={cn('rounded-lg border bg-white p-3', ordem >= 0 && 'border-primary ring-1 ring-primary')}>
              <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={ordem >= 0}
                    disabled={!podeBaixar || n.posicaoNaFila != null}
                    onCheckedChange={() => marcar(n.id)}
                    aria-label={`Selecionar NF ${n.numero}`}
                  />
                  {ordem >= 0 && (
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {ordem + 1}
                    </span>
                  )}
                  <span className="font-semibold">NF {n.numero}</span>
                </label>
                <span className="text-sm text-muted-foreground">Emissão {dia(n.emissao)}</span>
                <span className="text-sm">{[n.clienteCodigo, n.clienteNome].filter(Boolean).join(' — ') || '—'}</span>
                <span className="text-sm">{reais(n.valor)}</span>
                {n.pedidoVenda && <span className="text-sm text-muted-foreground">Pedido {n.pedidoVenda}</span>}
                {n.natureza && <span className="text-sm text-muted-foreground">{n.natureza}</span>}
                <span className="ml-auto"><Situacao s={n.situacao} posicao={n.posicaoNaFila} /></span>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Código</th>
                      <th className="py-1 pr-3 font-medium">Descrição</th>
                      <th className="py-1 pr-3 text-right font-medium">Qtd na nota</th>
                      <th className="py-1 text-right font-medium">Estoque PA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {n.itens.map((i, k) => (
                      <tr key={`${i.codigo}-${k}`} className="border-t">
                        <td className="py-1 pr-3 font-mono">{i.codigo || '—'}</td>
                        <td className="py-1 pr-3">{i.descricao || '—'}</td>
                        <td className="py-1 pr-3 text-right">{qtd(i.quantidade)}</td>
                        <td className={cn('py-1 text-right', i.estoquePa != null && i.estoquePa < i.quantidade && 'font-semibold text-destructive')}>
                          {i.estoquePa == null ? '—' : qtd(i.estoquePa)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
        {dados.compels === 'ok' && notas.length === 0 && (
          <p className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">Nenhuma nota pendente de baixa.</p>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-tinta">Fila</h3>
        {dados.aguardando.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma nota aguardando na fila.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Posição</th>
                  <th className="p-2 font-medium">Nota</th>
                  <th className="p-2 font-medium">Cliente</th>
                  <th className="p-2 font-medium">Colocada por</th>
                  <th className="p-2 font-medium">Quando</th>
                  <th className="p-2 font-medium">Última tentativa</th>
                  <th className="p-2 font-medium">Mensagem</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {dados.aguardando.map((l, k) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2">{k + 1}</td>
                    <td className="p-2 font-semibold">NF {l.numero}</td>
                    <td className="p-2">{l.cliente || '—'}</td>
                    <td className="p-2">{l.colocadoPorNome || '—'}</td>
                    <td className="p-2">{quando(l.colocadoEm)}</td>
                    <td className="p-2">{quando(l.ultimaTentativaEm)}</td>
                    <td className="p-2 text-muted-foreground">{l.ultimaMensagem || '—'}</td>
                    <td className="p-2 text-right">
                      {podeBaixar && (
                        <Button size="sm" variant="outline" disabled={pendente} onClick={() => tirar(l)}>Tirar da fila</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dados.falhas.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold text-destructive">Saíram da fila sem baixar (últimos 7 dias)</h4>
            <ul className="text-sm">
              {dados.falhas.map((l) => (
                <li key={l.id} className="border-t py-1">
                  <span className="font-semibold">NF {l.numero}</span> · {l.cliente || '—'} · {quando(l.finalizadoEm)} —{' '}
                  <span className="text-muted-foreground">{l.ultimaMensagem}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Dialog open={aberto} onOpenChange={(v) => { if (!pendente) setAberto(v) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{resultado ? 'Resultado' : `Baixar ${selecionadas.length} nota(s)`}</DialogTitle>
          </DialogHeader>
          {resultado ? (
            <ul className="flex flex-col gap-1 text-sm">
              {resultado.map((r) => (
                <li key={r.notaId}>
                  <span className="font-semibold">NF {r.numero ?? r.notaId}</span>: {TEXTO_RESULTADO[r.resultado]}
                  {r.posicao != null && ` (posição ${r.posicao})`}
                  {r.detalhe && <span className="text-muted-foreground"> — {r.detalhe}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <>
              {dados.modo === 'simular' && (
                <p className="text-sm text-amber-900">Simulação: nenhuma nota será baixada de verdade.</p>
              )}
              <ol className="flex flex-col gap-1 text-sm">
                {previsao.map((p, k) => {
                  const n = porId.get(p.notaId)
                  const motivo = n?.situacao.tipo === 'manual' ? n.situacao.motivo : ''
                  return (
                    <li key={p.notaId}>
                      {k + 1}. <span className="font-semibold">NF {n?.numero}</span> — {TEXTO_PREVISAO(p, motivo)}
                    </li>
                  )
                })}
              </ol>
              <p className="text-xs text-muted-foreground">
                É uma previsão: cada nota é relida no Compels na hora, na ordem acima.
              </p>
            </>
          )}
          <DialogFooter>
            {resultado ? (
              <Button onClick={() => setAberto(false)}>Fechar</Button>
            ) : (
              <>
                <Button variant="outline" disabled={pendente} onClick={() => setAberto(false)}>Cancelar</Button>
                <Button disabled={pendente || !podeConfirmar} onClick={confirmar}>
                  {pendente ? 'Baixando…' : 'Confirmar'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
