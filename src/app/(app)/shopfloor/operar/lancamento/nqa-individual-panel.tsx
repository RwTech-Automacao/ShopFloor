'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { carregarLoteNqaIndividual, finalizarNqaIndividual, validarBipeLoteIndividual, type LoteNqaIndividual } from '@/modules/shopfloor/application/nqa-individual-actions'
import { type AmostraNqa } from '@/modules/shopfloor/application/nqa-caixa-actions'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
import { salvarNqaIndividualProgresso, limparNqaIndividualProgresso, lerNqaIndividualProgresso } from './nqa-individual-progresso-local'

const OPCOES_INSPECAO = ['Aprovado', 'Reprovado', 'Não aplicável']

/** Uma amostra é reprovada se Visual OU Funcional for "Reprovado". */
function amostraReprovada(a: { visual: string; funcional: string }): boolean {
  return a.visual === 'Reprovado' || a.funcional === 'Reprovado'
}

/**
 * NQA INDIVIDUAL (inspeção por amostragem) — OPs de embalagem individual, onde não existe caixa
 * física agrupando várias peças (cada peça é seu próprio "pacote"). A pessoa do NQA define o lote
 * na hora: bipa peça a peça quais SNs fazem parte dele; ao fechar, a QUANTIDADE bipada define a
 * amostra pela Tabela NQA (mesma tabela do NQA por caixa). Daí em diante o fluxo espelha a caixa:
 * inspeciona N amostras (Visual+Funcional); todas aprovadas → "Aprovar lote" libera o lote inteiro;
 * qualquer reprovada → lote reprovado volta a um posto de retorno.
 */
export function NqaIndividualPanel({
  pmo, op, posto, cliente, colaborador, postos,
}: { pmo: string; op: string; posto: string; cliente: string; colaborador: string; postos: string[] }) {
  // Hidratação: se há um lote salvo (localStorage) do MESMO contexto (pmo/op/posto), restaura
  // a fase em que estava — montando o lote (snsLote) ou já inspecionando (lote fechado).
  const [hidratado] = useState(() => {
    const p = lerNqaIndividualProgresso()
    return p && p.pmo === pmo && p.op === op && p.posto === posto ? p : null
  })

  // Fase A: lote === null (declara a quantidade e bipa os SNs). Fase B: lote fechado (inspecionando).
  const [qtdLote, setQtdLote] = useState(hidratado?.qtdLote ?? '')
  const [snsLote, setSnsLote] = useState<string[]>(hidratado?.snsLote ?? [])
  const [snLote, setSnLote] = useState('')
  const [lote, setLote] = useState<LoteNqaIndividual | null>(hidratado?.lote ?? null)

  // Fase B: acúmulo das amostras + campos da amostra atual.
  const [amostras, setAmostras] = useState<AmostraNqa[]>(hidratado?.amostras ?? [])
  const [snAmostra, setSnAmostra] = useState('')
  const [visual, setVisual] = useState('')
  const [funcional, setFuncional] = useState('')
  const [observacao, setObservacao] = useState('')
  // Postos que o lote reprovado deve REPASSAR (multi-seleção). Ordenados pela OP na hora de enviar.
  const [selecionados, setSelecionados] = useState<string[]>(hidratado?.selecionados ?? [])

  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [fechando, startFechar] = useTransition()
  const [finalizando, startFinalizar] = useTransition()
  const { confirmar, dialog } = useConfirmacao()

  // Meta declarada pela pessoa antes de bipar. Só bipa depois de definida, e não passa dela.
  const meta = Number.parseInt(qtdLote, 10)
  const metaValida = Number.isInteger(meta) && meta > 0
  const completouMeta = metaValida && snsLote.length === meta

  const loteRef = useRef<HTMLInputElement>(null)
  const amostraRef = useRef<HTMLInputElement>(null)
  const focarLoteApos = useRef(false) // refocar o bipe do lote quando a finalização terminar

  // Postos de retorno = postos da OP menos o próprio NQA.
  const postosRetorno = postos.filter((p) => p !== posto)
  const algumReprovado = amostras.some(amostraReprovada)
  const amostraAtualReprova = visual === 'Reprovado' || funcional === 'Reprovado'
  const completa = lote !== null && amostras.length >= lote.amostra && !algumReprovado

  // Ao entrar na fase B (lote fechado), foca o campo de bipe da amostra.
  useEffect(() => {
    if (lote === null) return
    const id = setTimeout(() => amostraRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [lote])

  // Depois de finalizar (volta à fase A), refoca o bipe do lote.
  useEffect(() => {
    if (finalizando) return
    if (!focarLoteApos.current) return
    focarLoteApos.current = false
    loteRef.current?.focus()
  }, [finalizando])

  // Persiste o progresso (localStorage) a cada mudança relevante — some no refresh sem isto.
  useEffect(() => {
    if (snsLote.length === 0 && lote === null) return
    salvarNqaIndividualProgresso({ colaborador, cliente, pmo, op, posto, qtdLote, snsLote, lote, amostras, selecionados, salvoEm: Date.now() })
  }, [qtdLote, snsLote, lote, amostras, selecionados, colaborador, cliente, pmo, op, posto])

  function resetTudo() {
    setQtdLote('')
    setSnsLote([])
    setSnLote('')
    setLote(null)
    setAmostras([])
    setSnAmostra('')
    setVisual('')
    setFuncional('')
    setObservacao('')
    setSelecionados([])
    limparNqaIndividualProgresso()
  }

  /** "Descartar lote": joga fora o lote em montagem/inspeção. Nada foi gravado ainda — o banco só
   *  recebe algo em "Aprovar lote"/"Reprovar lote" —, mas o trabalho de bipar/inspecionar se perde. */
  async function onDescartar() {
    const emAndamento = snsLote.length > 0 || amostras.length > 0
    if (emAndamento) {
      const ok = await confirmar({
        titulo: 'Descartar este lote?',
        descricao:
          lote === null
            ? `As ${snsLote.length} peça(s) já bipadas serão perdidas e você começa um lote novo. Nada foi gravado no sistema.`
            : `O lote de ${lote.qtd} peça(s) e as ${amostras.length} amostra(s) já inspecionada(s) serão perdidos. Nada foi gravado no sistema.`,
        rotuloConfirmar: 'Descartar',
      })
      if (!ok) return
    }
    resetTudo()
    setResultado(null)
    setTimeout(() => loteRef.current?.focus(), 0)
  }

  /**
   * Fase A: bipe de uma peça do lote. Valida NO SERVIDOR antes de entrar na lista — pertence à OP,
   * JÁ FOI EMBALADA e não está no NQA agora. Na peça ÂNCORA (1ª do lote), verifica também se ela é
   * irmã de um lote reprovado anteriormente: se as demais já voltaram do retrabalho, pré-lista
   * todas automaticamente (igual a caixa reconhece pelo numero_caixa); se alguma ainda não voltou,
   * avisa quais faltam.
   */
  function onBiparLote() {
    if (snLote.trim() === '' || fechando) return
    if (!metaValida) {
      setResultado({ tipo: 'aviso', titulo: 'Informe a quantidade do lote antes de bipar as peças.' })
      return
    }
    if (snsLote.length >= meta) {
      setResultado({ tipo: 'aviso', titulo: `O lote já tem as ${meta} peça(s) que você definiu. Aumente a quantidade ou remova uma peça.` })
      setSnLote('')
      return
    }
    const norm = normalizarSerie(snLote)
    if (snsLote.some((s) => normalizarSerie(s) === norm)) {
      setResultado({ tipo: 'aviso', titulo: 'Este Nº de Série já está no lote.', chips: [{ rotulo: 'Nº Série', valor: snLote.trim(), mono: true }] })
      setSnLote('')
      setTimeout(() => loteRef.current?.focus(), 0)
      return
    }

    const ancora = snsLote.length === 0
    const snBipado = snLote.trim()
    setSnLote('')
    startFechar(async () => {
      const r = await validarBipeLoteIndividual(pmo, op, posto, snBipado, ancora)
      if (!r.ok) {
        setResultado({ tipo: 'aviso', titulo: r.erro, chips: [{ rotulo: 'Nº Série', valor: snBipado, mono: true }] })
        setTimeout(() => loteRef.current?.focus(), 0)
        return
      }
      const { elegiveis, pendentes } = r.irmas
      // Irmãs entram sem estourar a meta — o excedente fica de fora e é avisado.
      const cabem = Math.max(0, meta - (snsLote.length + 1))
      const entram = elegiveis.slice(0, cabem)
      const sobraram = elegiveis.slice(cabem)
      setSnsLote((prev) => [...prev, snBipado, ...entram.filter((e) => !prev.some((s) => normalizarSerie(s) === e))])

      if (elegiveis.length === 0 && pendentes.length === 0) {
        setResultado({ tipo: 'ok', titulo: 'Peça adicionada ao lote', chips: [{ rotulo: 'Nº Série', valor: snBipado, mono: true }] })
      } else {
        setResultado({
          tipo: pendentes.length > 0 || sobraram.length > 0 ? 'aviso' : 'ok',
          titulo:
            entram.length > 0
              ? `Peça de um lote reprovado — ${entram.length} peça(s)-irmã(s) adicionada(s) automaticamente`
              : 'Peça de um lote reprovado — veja as peças-irmãs abaixo',
          chips: [
            ...entram.map((s) => ({ rotulo: 'Irmã adicionada', valor: s, mono: true })),
            ...sobraram.map((s) => ({ rotulo: 'Não coube na meta', valor: s, mono: true })),
            ...pendentes.map((s) => ({ rotulo: 'Falta voltar', valor: s, mono: true })),
          ],
        })
      }
      setTimeout(() => loteRef.current?.focus(), 0)
    })
  }

  function removerDoLote(sn: string) {
    setSnsLote((prev) => prev.filter((s) => s !== sn))
  }

  /** Fecha o lote: valida no servidor (pertence à OP + ninguém já inspecionado) e calcula a amostra. */
  function onFecharLote() {
    if (snsLote.length === 0 || fechando) return
    startFechar(async () => {
      const r = await carregarLoteNqaIndividual(pmo, op, posto, snsLote)
      if (!r.ok) { setResultado({ tipo: 'aviso', titulo: r.erro }); return }
      setResultado(null)
      setLote(r.lote) // → fase B
    })
  }

  /** Fase B: acumula a amostra atual (Visual+Funcional já preenchidos) na lista. */
  function onAdicionarAmostra() {
    if (lote === null || finalizando) return
    if (algumReprovado) return // já em modo reprova — não bipa mais amostras
    if (snAmostra.trim() === '') { setResultado({ tipo: 'aviso', titulo: 'Bipe o Nº de Série da amostra.' }); return }
    if (visual === '' || funcional === '') { setResultado({ tipo: 'aviso', titulo: 'Selecione a Inspeção Visual e a Funcional da amostra.' }); return }
    const snNorm = normalizarSerie(snAmostra)
    if (!lote.snsNorm.includes(snNorm)) {
      setResultado({ tipo: 'aviso', titulo: 'Este Nº de Série NÃO é deste lote.', chips: [{ rotulo: 'Nº Série', valor: snAmostra.trim(), mono: true }] })
      setSnAmostra('')
      setTimeout(() => amostraRef.current?.focus(), 0)
      return
    }
    if (amostras.some((a) => a.snNorm === snNorm)) {
      setResultado({ tipo: 'aviso', titulo: 'Este Nº de Série já foi inspecionado neste lote.', chips: [{ rotulo: 'Nº Série', valor: snAmostra.trim(), mono: true }] })
      setSnAmostra('')
      setTimeout(() => amostraRef.current?.focus(), 0)
      return
    }
    const reprovou = amostraReprovada({ visual, funcional })
    // Observação só faz sentido em amostra reprovada — não carrega nota "fantasma" numa aprovada.
    const nova: AmostraNqa = { snNorm, visual, funcional, observacao: reprovou ? observacao.trim() : '' }
    setAmostras((prev) => [...prev, nova])
    setResultado({
      tipo: reprovou ? 'reprova' : 'ok',
      titulo: reprovou ? 'Amostra reprovada' : 'Amostra aprovada',
      chips: [
        { rotulo: 'Nº Série', valor: snAmostra.trim(), mono: true },
        { rotulo: 'Visual', valor: visual },
        { rotulo: 'Funcional', valor: funcional },
      ],
    })
    setSnAmostra('')
    setVisual('')
    setFuncional('')
    setObservacao('')
    if (!reprovou) setTimeout(() => amostraRef.current?.focus(), 0)
  }

  function onAprovarLote() {
    if (lote === null || finalizando || !completa) return
    startFinalizar(async () => {
      const r = await finalizarNqaIndividual({ colaborador, pmo, op, posto, snsNorm: lote.snsNorm, resultado: 'Aprovado', amostras })
      if (!r.ok) { setResultado({ tipo: 'aviso', titulo: r.erro }); return }
      setResultado({ tipo: 'ok', titulo: `Lote aprovado — ${r.total} peças`, chips: [{ rotulo: 'Peças', valor: String(r.total) }] })
      resetTudo()
      focarLoteApos.current = true
    })
  }

  function onReprovarLote() {
    if (lote === null || finalizando) return
    const postosOrdenados = postosRetorno.filter((p) => selecionados.includes(p))
    if (postosOrdenados.length === 0) { setResultado({ tipo: 'aviso', titulo: 'Escolha ao menos um posto que o lote deve repassar.' }); return }
    startFinalizar(async () => {
      const r = await finalizarNqaIndividual({ colaborador, pmo, op, posto, snsNorm: lote.snsNorm, resultado: 'Reprovado', postosRetorno: postosOrdenados, amostras })
      if (!r.ok) { setResultado({ tipo: 'aviso', titulo: r.erro }); return }
      setResultado({ tipo: 'reprova', titulo: `Lote reprovado — ${r.total} peças`, chips: [{ rotulo: 'Repassar', valor: postosOrdenados.join(' → ') }] })
      resetTudo()
      focarLoteApos.current = true
    })
  }

  // Fase A — declara a quantidade e bipa as peças do lote.
  if (lote === null) {
    return (
      <Card className="flex min-h-0 flex-col">
        {dialog}
        <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>NQA individual <span className="text-sm font-normal text-muted-foreground">· inspeção por amostragem</span></CardTitle>
          {snsLote.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onDescartar} disabled={fechando}>Descartar lote</Button>
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="shrink-0">
            <PainelResultado resultado={resultado} />
          </div>

          <div className="flex shrink-0 flex-col gap-1.5 sm:max-w-xs">
            <Label htmlFor="qtdLoteNqa">Quantidade do lote</Label>
            <Input
              id="qtdLoteNqa"
              type="number"
              min={1}
              inputMode="numeric"
              value={qtdLote}
              onChange={(e) => setQtdLote(e.target.value)}
              placeholder="Quantas peças este lote tem"
              autoComplete="off"
              autoFocus
              className="h-12 text-lg"
              disabled={fechando}
            />
          </div>

          <div className="flex shrink-0 flex-col gap-1.5">
            <Label htmlFor="snLoteNqa">Bipe as peças que fazem parte do lote</Label>
            <Input
              id="snLoteNqa"
              ref={loteRef}
              value={snLote}
              onChange={(e) => setSnLote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBiparLote() } }}
              placeholder={metaValida ? 'Bipe cada peça do lote, uma de cada vez' : 'Informe a quantidade do lote primeiro'}
              autoComplete="off"
              className="h-12 text-lg"
              disabled={fechando || !metaValida}
            />
            <p className="text-xs text-muted-foreground">
              Sem caixa física — você define o lote: primeiro a quantidade, depois bipa as peças. A quantidade define a amostra pela Tabela NQA.
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-border p-2">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {metaValida ? `${snsLote.length} de ${meta} peça(s) bipada(s)` : `${snsLote.length} peça(s) no lote`}
              </p>
              {metaValida && snsLote.length > meta && (
                <p className="text-xs text-amber-600">Remova {snsLote.length - meta} peça(s) ou aumente a quantidade</p>
              )}
            </div>
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {snsLote.length === 0 && <li className="text-sm text-muted-foreground">—</li>}
              {snsLote.map((sn) => (
                <li key={sn} className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1 text-sm">
                  <span className="font-mono">{sn}</span>
                  <button type="button" onClick={() => removerDoLote(sn)} aria-label={`Remover ${sn} do lote`} className="text-muted-foreground hover:text-foreground">
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="shrink-0">
            <Button onClick={onFecharLote} disabled={fechando || !completouMeta} className="h-11 bg-enterplak px-6 hover:bg-enterplak-700">
              {fechando
                ? 'Calculando amostra…'
                : completouMeta
                  ? `Fechar lote (${meta}) e calcular amostra`
                  : metaValida
                    ? `Faltam ${Math.max(0, meta - snsLote.length)} peça(s) para fechar o lote`
                    : 'Informe a quantidade do lote'}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Fase B — lote fechado, inspecionando a amostra.
  return (
    <Card className="flex min-h-0 flex-col">
      {dialog}
      <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>
          Lote — {lote.qtd} peças
          <span className="text-sm font-normal text-muted-foreground"> · amostra: {lote.amostra}</span>
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onDescartar} disabled={finalizando}>Descartar lote</Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0">
          <PainelResultado resultado={resultado} />
        </div>

        <div className="shrink-0">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">{amostras.length} / {lote.amostra} amostras</span>
            <span className="text-muted-foreground">{algumReprovado ? 'Lote reprovado' : completa ? 'Amostra completa' : 'Inspecionando…'}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${algumReprovado ? 'bg-red-600' : 'bg-enterplak'}`} style={{ width: `${Math.min(100, Math.round((amostras.length / Math.max(1, lote.amostra)) * 100))}%` }} />
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
                <Label htmlFor="obsAmostraInd">Observação</Label>
                <Input
                  id="obsAmostraInd"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Descreva o defeito (opcional)"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snAmostraNqaInd">Nº de Série da amostra</Label>
              <Input
                id="snAmostraNqaInd"
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

        {/* Modo REPROVA: escolhe o posto de retorno e reprova o lote inteiro. */}
        {algumReprovado && (
          <div className="flex shrink-0 flex-col gap-3 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/40">
            <p className="text-sm font-medium">Uma amostra reprovou — o lote inteiro volta para retrabalho.</p>
            <div className="flex flex-col gap-1.5">
              <Label>Postos que o lote deve repassar (repassa na ordem da OP, depois volta pro NQA)</Label>
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
              onClick={onReprovarLote}
              disabled={finalizando || selecionados.length === 0}
              className="h-11 self-start bg-red-600 px-6 text-white hover:bg-red-700"
            >
              {finalizando ? 'Reprovando…' : 'Reprovar lote'}
            </Button>
          </div>
        )}

        {/* Amostra completa e nenhuma reprovada → aprovar o lote. */}
        {completa && (
          <div className="shrink-0">
            <Button onClick={onAprovarLote} disabled={finalizando} className="h-11 bg-enterplak px-8 hover:bg-enterplak-700">
              {finalizando ? 'Aprovando…' : 'Aprovar lote'}
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
