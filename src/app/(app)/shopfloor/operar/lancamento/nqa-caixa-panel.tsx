'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { carregarNqaCaixa, finalizarNqaCaixa, type AmostraNqa, type CaixaNqa } from '@/modules/shopfloor/application/nqa-caixa-actions'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'

const OPCOES_INSPECAO = ['Aprovado', 'Reprovado', 'Não aplicável']

/** Uma amostra é reprovada se Visual OU Funcional for "Reprovado". */
function amostraReprovada(a: { visual: string; funcional: string }): boolean {
  return a.visual === 'Reprovado' || a.funcional === 'Reprovado'
}

/**
 * NQA por CAIXA (inspeção por amostragem) — OPs de embalagem coletiva. Bipe de "puxar caixa"
 * resolve a caixa + tamanho da amostra; inspeciona N amostras (Visual+Funcional); todas aprovadas
 * → "Aprovar caixa" libera a caixa; qualquer reprovada → caixa reprovada volta a um posto de retorno.
 */
export function NqaCaixaPanel({
  pmo, op, posto, colaborador, postos,
}: { pmo: string; op: string; posto: string; colaborador: string; postos: string[] }) {
  // Estado A: caixa === null (bipe pra puxar a caixa). Estado B: caixa preenchida (inspecionando).
  const [caixa, setCaixa] = useState<CaixaNqa | null>(null)
  const [snCaixa, setSnCaixa] = useState('')

  // Estado B: acúmulo das amostras + campos da amostra atual.
  const [amostras, setAmostras] = useState<AmostraNqa[]>([])
  const [snAmostra, setSnAmostra] = useState('')
  const [visual, setVisual] = useState('')
  const [funcional, setFuncional] = useState('')
  const [observacao, setObservacao] = useState('')
  // Postos que a caixa reprovada deve REPASSAR (multi-seleção). Ordenados pela OP na hora de enviar.
  const [selecionados, setSelecionados] = useState<string[]>([])

  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [carregando, startCarregar] = useTransition()
  const [finalizando, startFinalizar] = useTransition()

  const caixaRef = useRef<HTMLInputElement>(null)
  const amostraRef = useRef<HTMLInputElement>(null)
  const focarCaixaApos = useRef(false) // refocar o bipe da caixa quando a finalização terminar (volta ao estado A)

  // Postos de retorno = postos da OP menos o próprio NQA.
  const postosRetorno = postos.filter((p) => p !== posto)
  // Alguma amostra reprovada → a caixa inteira reprova (modo REPROVA).
  const algumReprovado = amostras.some(amostraReprovada)
  const amostraAtualReprova = visual === 'Reprovado' || funcional === 'Reprovado'
  const completa = caixa !== null && amostras.length >= caixa.amostra && !algumReprovado

  // Ao entrar no estado B (caixa resolvida), foca o campo de bipe da amostra.
  useEffect(() => {
    if (caixa === null) return
    const id = setTimeout(() => amostraRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [caixa])

  // Depois de finalizar (volta ao estado A), refoca o bipe da caixa — mesmo padrão da Embalagem
  // (o input fica disabled durante a transição; foca quando ela termina e o campo remonta).
  useEffect(() => {
    if (finalizando) return
    if (!focarCaixaApos.current) return
    focarCaixaApos.current = false
    caixaRef.current?.focus()
  }, [finalizando])

  function resetInspecao() {
    setCaixa(null)
    setAmostras([])
    setSnCaixa('')
    setSnAmostra('')
    setVisual('')
    setFuncional('')
    setObservacao('')
    setSelecionados([])
  }

  /** Estado A: bipe de "puxar caixa" → resolve a caixa e o tamanho da amostra. */
  function onPuxarCaixa() {
    if (snCaixa.trim() === '' || carregando) return
    const sn = snCaixa
    startCarregar(async () => {
      const r = await carregarNqaCaixa(pmo, op, posto, sn)
      if (!r.ok) {
        setResultado({ tipo: 'aviso', titulo: r.erro, chips: [{ rotulo: 'Nº Série', valor: sn.trim(), mono: true }] })
        setSnCaixa('')
        setTimeout(() => caixaRef.current?.focus(), 0)
        return
      }
      if (r.caixa.jaInspecionada) {
        setResultado({ tipo: 'aviso', titulo: 'Esta caixa já foi inspecionada no NQA', chips: [{ rotulo: 'Caixa', valor: r.caixa.numeroCaixa, mono: true }] })
        setSnCaixa('')
        setTimeout(() => caixaRef.current?.focus(), 0)
        return
      }
      setResultado(null)
      setSnCaixa('')
      setCaixa(r.caixa) // → estado B
    })
  }

  /** Estado B: acumula a amostra atual (Visual+Funcional já preenchidos) na lista. */
  function onAdicionarAmostra() {
    if (caixa === null || finalizando) return
    if (algumReprovado) return // já em modo reprova — não bipa mais amostras
    if (snAmostra.trim() === '') { setResultado({ tipo: 'aviso', titulo: 'Bipe o Nº de Série da amostra.' }); return }
    if (visual === '' || funcional === '') { setResultado({ tipo: 'aviso', titulo: 'Selecione a Inspeção Visual e a Funcional da amostra.' }); return }
    const snNorm = normalizarSerie(snAmostra)
    if (!caixa.snsNorm.includes(snNorm)) {
      setResultado({ tipo: 'aviso', titulo: 'Este Nº de Série NÃO é desta caixa.', chips: [{ rotulo: 'Nº Série', valor: snAmostra.trim(), mono: true }, { rotulo: 'Caixa', valor: caixa.numeroCaixa, mono: true }] })
      setSnAmostra('')
      setTimeout(() => amostraRef.current?.focus(), 0)
      return
    }
    if (amostras.some((a) => a.snNorm === snNorm)) {
      setResultado({ tipo: 'aviso', titulo: 'Este Nº de Série já foi inspecionado nesta caixa.', chips: [{ rotulo: 'Nº Série', valor: snAmostra.trim(), mono: true }] })
      setSnAmostra('')
      setTimeout(() => amostraRef.current?.focus(), 0)
      return
    }
    const nova: AmostraNqa = { snNorm, visual, funcional, observacao: observacao.trim() }
    setAmostras((prev) => [...prev, nova])
    const reprovou = amostraReprovada(nova)
    setResultado({
      tipo: reprovou ? 'reprova' : 'ok',
      titulo: reprovou ? 'Amostra reprovada' : 'Amostra aprovada',
      chips: [
        { rotulo: 'Nº Série', valor: snAmostra.trim(), mono: true },
        { rotulo: 'Visual', valor: visual },
        { rotulo: 'Funcional', valor: funcional },
      ],
    })
    // limpa os campos da amostra pra próxima; se reprovou, o modo reprova assume (mostra o picker de retorno)
    setSnAmostra('')
    setVisual('')
    setFuncional('')
    setObservacao('')
    if (!reprovou) setTimeout(() => amostraRef.current?.focus(), 0)
  }

  function onAprovarCaixa() {
    if (caixa === null || finalizando || !completa) return
    startFinalizar(async () => {
      const r = await finalizarNqaCaixa({ colaborador, pmo, op, posto, numeroCaixa: caixa.numeroCaixa, resultado: 'Aprovado', amostras })
      if (!r.ok) { setResultado({ tipo: 'aviso', titulo: r.erro }); return }
      setResultado({ tipo: 'ok', titulo: `Caixa ${caixa.numeroCaixa} aprovada — ${r.total} peças`, chips: [{ rotulo: 'Caixa', valor: caixa.numeroCaixa, mono: true }] })
      resetInspecao()
      focarCaixaApos.current = true
    })
  }

  function onReprovarCaixa() {
    if (caixa === null || finalizando) return
    // Ordena os escolhidos pela ordem da OP (postosRetorno já vem em ordem da OP).
    const postosOrdenados = postosRetorno.filter((p) => selecionados.includes(p))
    if (postosOrdenados.length === 0) { setResultado({ tipo: 'aviso', titulo: 'Escolha ao menos um posto que a caixa deve repassar.' }); return }
    startFinalizar(async () => {
      const r = await finalizarNqaCaixa({ colaborador, pmo, op, posto, numeroCaixa: caixa.numeroCaixa, resultado: 'Reprovado', postosRetorno: postosOrdenados, amostras })
      if (!r.ok) { setResultado({ tipo: 'aviso', titulo: r.erro }); return }
      setResultado({ tipo: 'reprova', titulo: `Caixa ${caixa.numeroCaixa} reprovada — ${r.total} peças`, chips: [{ rotulo: 'Caixa', valor: caixa.numeroCaixa, mono: true }, { rotulo: 'Repassar', valor: postosOrdenados.join(' → ') }] })
      resetInspecao()
      focarCaixaApos.current = true
    })
  }

  // Estado A — sem caixa: bipe pra puxar a caixa.
  if (caixa === null) {
    return (
      <Card className="flex min-h-0 flex-col">
        <CardHeader className="shrink-0">
          <CardTitle>NQA por caixa <span className="text-sm font-normal text-muted-foreground">· inspeção por amostragem</span></CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="shrink-0">
            <PainelResultado resultado={resultado} />
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <Label htmlFor="snCaixaNqa">Bipe um SN da caixa</Label>
            <Input
              id="snCaixaNqa"
              ref={caixaRef}
              value={snCaixa}
              onChange={(e) => setSnCaixa(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onPuxarCaixa() } }}
              placeholder="Bipe qualquer peça da caixa"
              autoComplete="off"
              autoFocus
              className="h-12 text-lg"
              disabled={carregando}
            />
            <p className="text-xs text-muted-foreground">O sistema localiza a caixa e o tamanho da amostra pela Tabela NQA.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Estado B — inspecionando a caixa resolvida.
  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>
          Caixa {caixa.numeroCaixa}
          <span className="text-sm font-normal text-muted-foreground"> · {caixa.qtd} peças · amostra: {caixa.amostra}</span>
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={resetInspecao} disabled={finalizando}>Trocar caixa</Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0">
          <PainelResultado resultado={resultado} />
        </div>

        <div className="shrink-0">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{amostras.length} / {caixa.amostra} amostras</span>
            <span className="text-muted-foreground">{algumReprovado ? 'Caixa reprovada' : completa ? 'Amostra completa' : 'Inspecionando…'}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${algumReprovado ? 'bg-red-600' : 'bg-enterplak'}`} style={{ width: `${Math.min(100, Math.round((amostras.length / Math.max(1, caixa.amostra)) * 100))}%` }} />
          </div>
        </div>

        {/* Campos da amostra atual — enquanto não estiver em modo reprova e a amostra não estiver completa. */}
        {!algumReprovado && !completa && (
          <div className="flex shrink-0 flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Inspeção Visual</Label>
                <Select value={visual} onValueChange={(v) => setVisual((v as string) ?? '')}>
                  <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{OPCOES_INSPECAO.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Inspeção Funcional</Label>
                <Select value={funcional} onValueChange={(v) => setFuncional((v as string) ?? '')}>
                  <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{OPCOES_INSPECAO.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {amostraAtualReprova && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="obsAmostra">Observação</Label>
                <Input
                  id="obsAmostra"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Descreva o defeito (opcional)"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snAmostraNqa">Nº de Série da amostra</Label>
              <Input
                id="snAmostraNqa"
                ref={amostraRef}
                value={snAmostra}
                onChange={(e) => setSnAmostra(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdicionarAmostra() } }}
                placeholder="Bipe a peça da amostra"
                autoComplete="off"
                className="h-12 text-lg"
                disabled={finalizando}
              />
            </div>
            <p className="text-xs text-muted-foreground">Selecione Visual e Funcional, depois bipe o Nº de Série da amostra.</p>
          </div>
        )}

        {/* Modo REPROVA: escolhe o posto de retorno e reprova a caixa inteira. */}
        {algumReprovado && (
          <div className="flex shrink-0 flex-col gap-3 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/40">
            <p className="text-sm font-medium">Uma amostra reprovou — a caixa inteira volta para retrabalho.</p>
            <div className="flex flex-col gap-1.5">
              <Label>Postos que a caixa deve repassar (repassa na ordem da OP, depois volta pro NQA)</Label>
              <div className="flex flex-wrap gap-2">
                {postosRetorno.map((p) => {
                  const marcado = selecionados.includes(p)
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setSelecionados((atual) =>
                          marcado ? atual.filter((x) => x !== p) : [...atual, p],
                        )
                      }
                      className={
                        'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                        (marcado
                          ? 'border-enterplak bg-enterplak text-white'
                          : 'border-border bg-card hover:bg-muted')
                      }
                    >
                      {p}
                    </button>
                  )
                })}
              </div>
              {selecionados.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Vai repassar: {postosRetorno.filter((p) => selecionados.includes(p)).join(' → ')} → NQA
                </p>
              )}
            </div>
            <Button
              onClick={onReprovarCaixa}
              disabled={finalizando || selecionados.length === 0}
              className="h-11 self-start bg-red-600 px-6 text-white hover:bg-red-700"
            >
              {finalizando ? 'Reprovando…' : 'Reprovar caixa'}
            </Button>
          </div>
        )}

        {/* Amostra completa e nenhuma reprovada → aprovar a caixa. */}
        {completa && (
          <div className="shrink-0">
            <Button onClick={onAprovarCaixa} disabled={finalizando} className="h-11 bg-enterplak px-8 hover:bg-enterplak-700">
              {finalizando ? 'Aprovando…' : 'Aprovar caixa'}
            </Button>
          </div>
        )}

        {/* Amostras acumuladas. */}
        <div className="flex min-h-0 flex-col rounded-lg border border-border p-2">
          <p className="mb-1 shrink-0 text-xs font-medium text-muted-foreground">Amostras inspecionadas ({amostras.length})</p>
          <ul className="flex max-h-[8rem] flex-col gap-0.5 overflow-y-auto text-sm">
            {amostras.length === 0 && <li className="text-muted-foreground">—</li>}
            {amostras.map((a, i) => (
              <li key={`${a.snNorm}-${i}`} className="flex items-center justify-between gap-2">
                <span className="font-mono">{a.snNorm}</span>
                <span className={amostraReprovada(a) ? 'text-red-600' : 'text-green-700'}>
                  {a.visual} · {a.funcional}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
