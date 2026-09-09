'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { carregarEmbalagem, embalarPeca, fecharCaixa, type ResultadoEmbalar } from '@/modules/shopfloor/application/embalagem-actions'
import type { RemontagemCaixa } from '@/modules/shopfloor/infra/caixa-repository'

/**
 * Embalagem por CAIXA. O layout segue o padrão das outras telas do Lançamento: topo com a Peça
 * (campo de bipe) à esquerda e o Contexto compacto à direita, e o acompanhamento da caixa em
 * LARGURA CHEIA embaixo. O Contexto entra por prop porque quem o monta é o formulário — assim o
 * painel controla o próprio arranjo em vez de ser espremido numa coluna estreita pelo pai.
 */
export function EmbalagemPanel({
  colaborador, pmo, op, posto, qtdOP, contexto,
}: { colaborador: string; pmo: string; op: string; posto: string; qtdOP: number | null; contexto?: React.ReactNode }) {
  const [seq, setSeq] = useState(1)
  const [limite, setLimite] = useState<number | null>(null)
  const [limiteInput, setLimiteInput] = useState('')
  const [qtdNaCaixa, setQtdNaCaixa] = useState(0)
  const [totalEmbaladas, setTotalEmbaladas] = useState(0)
  const [snsNaCaixa, setSnsNaCaixa] = useState<string[]>([])
  const [concluida, setConcluida] = useState(false)
  // Remontagem: a caixa da tela está refazendo uma montagem reprovada no NQA. `seqEmFoco` fixa qual
  // caixa recarregar — sem ele o servidor devolveria de novo a caixa da vez, não a que estamos refazendo.
  const [remontagem, setRemontagem] = useState<RemontagemCaixa | null>(null)
  const [pendentesRemontagem, setPendentesRemontagem] = useState<number[]>([])
  const [seqEmFoco, setSeqEmFoco] = useState<number | null>(null)
  const [pendente, setPendente] = useState<{ sn: string; motivo: string } | null>(null)
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

  function recarregar(foco?: number | null, manterResultado = false) {
    startCarregar(async () => {
      if (!manterResultado) setResultado(null) // contexto novo (troca de OP/posto) → limpa o painel
      const alvo = foco === undefined ? seqEmFoco : foco
      const r = await carregarEmbalagem(pmo, op, posto, alvo ?? undefined)
      if (!r.ok) { setResultado({ tipo: 'aviso', titulo: r.erro }); return }
      setSeq(r.estado.seq)
      setLimite(r.estado.limite)
      setQtdNaCaixa(r.estado.qtdNaCaixa)
      setTotalEmbaladas(r.estado.totalEmbaladas)
      setSnsNaCaixa(r.estado.snsNaCaixa)
      setConcluida(r.estado.concluida)
      setRemontagem(r.estado.remontagem)
      setPendentesRemontagem(r.estado.remontagensPendentes)
    })
  }
  // Troca de OP/posto zera o foco: a remontagem é de uma caixa daquele contexto, não deste.
  useEffect(() => { setSeqEmFoco(null); setPendente(null); recarregar(null) }, [pmo, op, posto])

  function definirLimite() {
    const n = Number(limiteInput)
    if (!Number.isInteger(n) || n <= 0) { setResultado({ tipo: 'aviso', titulo: 'Informe um limite válido (inteiro > 0).' }); return }
    setLimite(n)
    setTimeout(() => snRef.current?.focus(), 0)
  }

  function onBipar() {
    if (sn.trim() === '' || embalando || limite === null || pendente) return
    const alvo = sn
    startEmbalar(async () => {
      const r = await embalarPeca({ colaborador, pmo, op, posto, seq, limite, numeroSerie: alvo, ultima: ehUltima })
      aplicarBipe(r, alvo)
    })
  }

  /** Inclui a peça que não era da caixa original — o operador já leu o motivo e decidiu. */
  function incluirMesmoAssim() {
    const p = pendente
    if (!p || embalando || limite === null) return
    setPendente(null)
    startEmbalar(async () => {
      const r = await embalarPeca({
        colaborador, pmo, op, posto, seq, limite, numeroSerie: p.sn, ultima: ehUltima,
        confirmarForaDaCaixa: true,
      })
      aplicarBipe(r, p.sn)
    })
  }

  function aplicarBipe(r: ResultadoEmbalar, alvo: string) {
    if (!r.ok) {
      // Peça fora da caixa original: não é erro, é uma decisão do operador — guarda e pergunta.
      if (r.confirmar) {
        setPendente({ sn: alvo, motivo: r.confirmar.motivo })
        setResultado(null)
        setSn('')
        return
      }
      setResultado({
        tipo: 'aviso',
        titulo: r.erro,
        chips: [{ rotulo: 'Nº Série', valor: alvo.trim(), mono: true }],
        dica: /cheia/i.test(r.erro) ? 'Feche a caixa e continue na próxima.' : undefined,
      })
      setSn('') // bipe errado → limpa o campo pra bipar outro
      acaoAposEmbalar.current = 'focus'
      return
    }
    setSn('')
    acaoAposEmbalar.current = 'focus' // refoca quando a transição terminar (input volta a habilitar)

    // O servidor pode ter mandado a peça pra OUTRA caixa (ela voltou de uma reprovada). O contador
    // e o limite locais são da caixa antiga, então aqui não dá pra somar 1: recarrega o estado real.
    if (r.seq !== seq) {
      setSeqEmFoco(r.seq)
      setEhUltima(false) // "última caixa" é decisão do fim da OP; não vale numa remontagem
      setResultado({
        tipo: 'ok',
        titulo: `Peça embalada — voltou pra CX${r.seq}`,
        chips: [{ rotulo: 'Nº Série', valor: alvo.trim(), mono: true }],
      })
      recarregar(r.seq, true)
      return
    }

    setResultado({
      tipo: 'ok',
      titulo: 'Peça embalada',
      chips: [{ rotulo: 'Nº Série', valor: alvo.trim(), mono: true }, { rotulo: 'Caixa', valor: `CX${seq} · ${qtdNaCaixa + 1}/${limite}` }],
    })
    setQtdNaCaixa((q) => q + 1)
    setTotalEmbaladas((t) => t + 1)
    setSnsNaCaixa((prev) => [alvo.trim(), ...prev])
    if (remontagem) setRemontagem({ ...remontagem, faltando: remontagem.faltando.filter((s) => s !== alvo.trim()) })
  }

  async function onFechar() {
    if (fechando || limite === null || qtdNaCaixa === 0) return
    // Numa remontagem, o que importa não é o limite e sim quem da caixa original ainda não voltou.
    const faltando = remontagem?.faltando ?? []
    if (faltando.length > 0) {
      const ok = await confirmar({
        titulo: `Fechar a CX${seq} sem ${faltando.length} peça${faltando.length === 1 ? '' : 's'} da caixa original?`,
        descricao: `Não voltaram: ${faltando.join(', ')}.`,
        rotuloConfirmar: 'Fechar assim',
      })
      if (!ok) return
    } else if (!remontagem && qtdNaCaixa < limite) {
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
      setPendente(null)
      // Remontagem fechada → volta pra caixa que estava em andamento antes, com as peças dela.
      if (seqEmFoco !== null) { setSeqEmFoco(null); recarregar(null, true); setTimeout(() => snRef.current?.focus(), 0); return }
      if (ehUltima) { setConcluida(true) }
      else { setSeq((s) => s + 1); setQtdNaCaixa(0); setSnsNaCaixa([]); setEhUltima(false); setTimeout(() => snRef.current?.focus(), 0) }
    })
  }

  // Nas telas simples o Contexto fica ao lado, meio a meio — o operador não perde o cabeçalho.
  const comContexto = (cartao: React.ReactNode) => (
    <div className="grid shrink-0 gap-3 lg:grid-cols-2">{cartao}{contexto}</div>
  )

  if (carregando && limite === null && !concluida) {
    return comContexto(<Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Carregando…</CardContent></Card>)
  }
  if (concluida) {
    return comContexto(
      <Card>
        <CardHeader><CardTitle>Embalagem concluída</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Total embaladas: {totalEmbaladas}{qtdOP ? ` / ${qtdOP} do contrato` : ''}.</p>
          <p className="text-xs text-muted-foreground">A última caixa desta OP foi fechada.</p>
        </CardContent>
      </Card>,
    )
  }
  if (limite === null) {
    return comContexto(
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
      </Card>,
    )
  }

  const pct = Math.min(100, Math.round((qtdNaCaixa / limite) * 100))
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Topo: Peça | Contexto — mesmo arranjo da bipagem normal, pra quem troca de posto encontrar
          o campo no mesmo lugar. Antes o campo dividia a linha com a lista de SNs (16rem fixos) e
          sobrava quase nada pra ele quando o painel era estreito. */}
      <div className="grid shrink-0 gap-3 lg:grid-cols-2">
        <Card size="sm" className="flex min-h-0 flex-col">
          <CardHeader className="shrink-0 flex flex-row items-center justify-between gap-2">
            <CardTitle>Peça</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="snCaixa">Nº de Série</Label>
            <Input id="snCaixa" ref={snRef} value={sn} onChange={(e) => setSn(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBipar() } }}
              placeholder="Bipe a peça" autoComplete="off" autoFocus className="h-12 text-lg" disabled={embalando} />
          </CardContent>
        </Card>
        {contexto}
      </div>

      {/* Acompanhamento da caixa em LARGURA CHEIA: resultado, progresso e as peças já bipadas. */}
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Caixa CX{seq} <span className="text-sm font-normal text-muted-foreground">· limite {limite}</span>
            {remontagem && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">remontagem</span>}
          </CardTitle>
          <div className="flex items-center gap-3">
            {/* Numa remontagem a caixa tem tamanho conhecido — "última caixa" só confundiria. */}
            {!remontagem && (
              <label className="flex items-center gap-1.5 text-sm" title="A última caixa pode passar do limite — bipe as peças que sobram aqui em vez de abrir caixa nova.">
                <input type="checkbox" checked={ehUltima} onChange={(e) => setEhUltima(e.target.checked)} /> Última caixa
              </label>
            )}
            <Button variant="outline" size="sm" onClick={onFechar} disabled={fechando || qtdNaCaixa === 0}>
              {fechando ? 'Fechando…' : 'Fechar caixa'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Caixa reprovada esperando remontagem. Fica como recado, não como interrupção: quem
              decide quando refazer é o operador, e a caixa dela é puxada ao bipar uma peça sua. */}
          {!remontagem && pendentesRemontagem.length > 0 && (
            <p className="shrink-0 text-xs text-muted-foreground">
              Aguardando remontagem: {pendentesRemontagem.map((s) => `CX${s}`).join(', ')} — bipe uma peça dela pra continuar aquela caixa.
            </p>
          )}

          {/* Refazendo uma caixa reprovada: diz de onde ela veio e quem ainda não voltou. */}
          {remontagem && (
            <div className="shrink-0 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                ⟲ Refazendo a CX{seq} — reprovada no NQA · {remontagem.snsOriginais.length} peça{remontagem.snsOriginais.length === 1 ? '' : 's'} na original
              </p>
              <p className="mt-0.5 font-mono text-xs text-amber-800 dark:text-amber-300">{remontagem.codigoAnterior}</p>
              {remontagem.faltando.length > 0 && (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  Ainda não voltaram ({remontagem.faltando.length}): <span className="font-mono">{remontagem.faltando.join(', ')}</span>
                </p>
              )}
            </div>
          )}

          {/* Peça que não era da caixa original: entra, mas com o operador sabendo o que está fazendo. */}
          {pendente && (
            <div className="shrink-0 rounded-lg border border-amber-500 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/40">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{pendente.motivo}</p>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setPendente(null); setTimeout(() => snRef.current?.focus(), 0) }}>Cancelar</Button>
                <Button size="sm" onClick={incluirMesmoAssim} disabled={embalando}>Incluir mesmo assim</Button>
              </div>
            </div>
          )}

          <div className="shrink-0">
            <PainelResultado resultado={resultado} />
          </div>
          <div className="shrink-0">
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-medium">{ehUltima ? `${qtdNaCaixa} nesta caixa · última (sem limite)` : `${qtdNaCaixa} / ${limite} nesta caixa`}</span>
              <span className="text-muted-foreground">Total: {totalEmbaladas}{qtdOP ? ` / ${qtdOP} do contrato` : ''}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-enterplak" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-lg border border-border p-2">
            <p className="mb-1 shrink-0 text-xs font-medium text-muted-foreground">Nesta caixa ({snsNaCaixa.length})</p>
            {/* Rola cedo (~5 SNs), no mesmo padrão dos históricos das outras telas (max-h-[8rem]). */}
            <ul className="flex max-h-[8rem] flex-col gap-0.5 overflow-y-auto text-sm">
              {snsNaCaixa.length === 0 && <li className="text-muted-foreground">—</li>}
              {snsNaCaixa.map((s, i) => <li key={`${s}-${i}`} className="font-mono">{s}</li>)}
            </ul>
          </div>
        </CardContent>
      </Card>
      {dialog}
    </div>
  )
}
