'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { carregarEmbalagem, embalarPeca, fecharCaixa } from '@/modules/shopfloor/application/embalagem-actions'

export function EmbalagemPanel({
  colaborador, pmo, op, posto, qtdOP,
}: { colaborador: string; pmo: string; op: string; posto: string; qtdOP: number | null }) {
  const [seq, setSeq] = useState(1)
  const [limite, setLimite] = useState<number | null>(null)
  const [limiteInput, setLimiteInput] = useState('')
  const [qtdNaCaixa, setQtdNaCaixa] = useState(0)
  const [totalEmbaladas, setTotalEmbaladas] = useState(0)
  const [snsNaCaixa, setSnsNaCaixa] = useState<string[]>([])
  const [concluida, setConcluida] = useState(false)
  const [sn, setSn] = useState('')
  const [ehUltima, setEhUltima] = useState(false)
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [carregando, startCarregar] = useTransition()
  const [embalando, startEmbalar] = useTransition()
  const [fechando, startFechar] = useTransition()
  const snRef = useRef<HTMLInputElement>(null)
  const acaoAposEmbalar = useRef<null | 'focus' | 'select'>(null)
  const { confirmar, dialog } = useConfirmacao()

  // O input fica disabled durante a transição de embalar; refoca (ou seleciona, no erro)
  // quando ela termina, pra o operador bipar a próxima peça sem tocar no mouse.
  useEffect(() => {
    if (embalando) return
    const a = acaoAposEmbalar.current
    if (!a) return
    acaoAposEmbalar.current = null
    const el = snRef.current
    if (!el) return
    el.focus()
    if (a === 'select') el.select()
  }, [embalando])

  function recarregar() {
    startCarregar(async () => {
      setResultado(null) // contexto novo (troca de OP/posto) → limpa o painel da ação anterior
      const r = await carregarEmbalagem(pmo, op, posto)
      if (!r.ok) { setResultado({ tipo: 'aviso', titulo: r.erro }); return }
      setSeq(r.estado.seq)
      setLimite(r.estado.limite)
      setQtdNaCaixa(r.estado.qtdNaCaixa)
      setTotalEmbaladas(r.estado.totalEmbaladas)
      setSnsNaCaixa(r.estado.snsNaCaixa)
      setConcluida(r.estado.concluida)
    })
  }
  useEffect(() => { recarregar() }, [pmo, op, posto]) // recarrega ao entrar / trocar contexto

  function definirLimite() {
    const n = Number(limiteInput)
    if (!Number.isInteger(n) || n <= 0) { setResultado({ tipo: 'aviso', titulo: 'Informe um limite válido (inteiro > 0).' }); return }
    setLimite(n)
    setTimeout(() => snRef.current?.focus(), 0)
  }

  function onBipar() {
    if (sn.trim() === '' || embalando || limite === null) return
    const alvo = sn
    startEmbalar(async () => {
      const r = await embalarPeca({ colaborador, pmo, op, posto, seq, limite, numeroSerie: alvo })
      if (!r.ok) {
        setResultado({
          tipo: 'aviso',
          titulo: r.erro,
          chips: [{ rotulo: 'Nº Série', valor: alvo.trim(), mono: true }],
          dica: /cheia/i.test(r.erro) ? 'Feche a caixa e continue na próxima.' : undefined,
        })
        acaoAposEmbalar.current = 'select'
        return
      }
      setSn('')
      setResultado({
        tipo: 'ok',
        titulo: 'Peça embalada',
        chips: [{ rotulo: 'Nº Série', valor: alvo.trim(), mono: true }, { rotulo: 'Caixa', valor: `CX${seq} · ${qtdNaCaixa + 1}/${limite}` }],
      })
      setQtdNaCaixa((q) => q + 1)
      setTotalEmbaladas((t) => t + 1)
      setSnsNaCaixa((prev) => [alvo.trim(), ...prev])
      acaoAposEmbalar.current = 'focus' // refoca quando a transição terminar (input volta a habilitar)
    })
  }

  async function onFechar() {
    if (fechando || limite === null || qtdNaCaixa === 0) return
    if (qtdNaCaixa < limite) {
      const ok = await confirmar({
        titulo: `Fechar a caixa com ${qtdNaCaixa}/${limite}?`,
        descricao: 'A caixa vai ser fechada antes de atingir o limite.',
        rotuloConfirmar: 'Fechar caixa',
      })
      if (!ok) return
    }
    startFechar(async () => {
      const r = await fecharCaixa(pmo, op, posto, seq, ehUltima)
      if (!r.ok) { setResultado({ tipo: 'aviso', titulo: r.erro }); return }
      setResultado({ tipo: 'ok', titulo: 'Caixa fechada', chips: [{ rotulo: 'Código', valor: r.codigo, mono: true }] })
      if (ehUltima) { setConcluida(true) }
      else { setSeq((s) => s + 1); setQtdNaCaixa(0); setSnsNaCaixa([]); setEhUltima(false); setTimeout(() => snRef.current?.focus(), 0) }
    })
  }

  if (carregando && limite === null && !concluida) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Carregando…</CardContent></Card>
  }
  if (concluida) {
    return (
      <Card>
        <CardHeader><CardTitle>Embalagem concluída</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Total embaladas: {totalEmbaladas}{qtdOP ? ` / ${qtdOP} do contrato` : ''}.</p>
          <p className="text-xs text-muted-foreground">A última caixa desta OP foi fechada.</p>
        </CardContent>
      </Card>
    )
  }
  if (limite === null) {
    return (
      <Card>
        <CardHeader><CardTitle>Embalagem</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="limite">Limite por caixa</Label>
          <div className="flex gap-2">
            <Input id="limite" type="number" min="1" step="1" value={limiteInput}
              onChange={(e) => setLimiteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); definirLimite() } }}
              className="h-11 w-32" autoFocus />
            <Button onClick={definirLimite} className="h-11">Começar</Button>
          </div>
          <p className="text-xs text-muted-foreground">Definido uma vez; vale pras próximas caixas.</p>
        </CardContent>
        {dialog}
      </Card>
    )
  }

  const pct = Math.min(100, Math.round((qtdNaCaixa / limite) * 100))
  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Caixa CX{seq} <span className="text-sm font-normal text-muted-foreground">· limite {limite}</span></CardTitle>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={ehUltima} onChange={(e) => setEhUltima(e.target.checked)} /> Última caixa
          </label>
          <Button variant="outline" size="sm" onClick={onFechar} disabled={fechando || qtdNaCaixa === 0}>
            {fechando ? 'Fechando…' : 'Fechar caixa'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0">
          <PainelResultado resultado={resultado} />
        </div>
        <div className="shrink-0">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{qtdNaCaixa} / {limite} nesta caixa</span>
            <span className="text-muted-foreground">Total: {totalEmbaladas}{qtdOP ? ` / ${qtdOP} do contrato` : ''}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-enterplak" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_16rem]">
          <div className="flex shrink-0 flex-col gap-1.5">
            <Label htmlFor="snCaixa">Nº de Série</Label>
            <Input id="snCaixa" ref={snRef} value={sn} onChange={(e) => setSn(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBipar() } }}
              placeholder="Bipe a peça" autoComplete="off" autoFocus className="h-12 text-lg" disabled={embalando} />
          </div>
          <div className="flex flex-col rounded-lg border border-border p-2">
            <p className="mb-1 shrink-0 text-xs font-medium text-muted-foreground">Nesta caixa ({snsNaCaixa.length})</p>
            {/* Mostra ~8 SNs; o resto rola dentro do card. */}
            <ul className="flex max-h-[11.5rem] flex-col gap-0.5 overflow-y-auto text-sm">
              {snsNaCaixa.length === 0 && <li className="text-muted-foreground">—</li>}
              {snsNaCaixa.map((s, i) => <li key={`${s}-${i}`} className="font-mono">{s}</li>)}
            </ul>
          </div>
        </div>
      </CardContent>
      {dialog}
    </Card>
  )
}
