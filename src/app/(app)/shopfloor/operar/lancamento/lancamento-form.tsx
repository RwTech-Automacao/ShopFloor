'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { serieDentroDaFaixa } from '@/modules/shopfloor/domain/serie'
import { resolverOpPorSn } from '@/modules/shopfloor/domain/cabecalho-lancamento'
import { PERFIL_PADRAO, perfilTemStatus, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { formatarDuracao } from '@/modules/shopfloor/domain/tempo-burnin'
import { lancar, buscarEntradaBurnin } from '@/modules/shopfloor/application/lancar-action'
import type { OrdemLancamentoLista } from '@/modules/shopfloor/infra/lancamento-repository'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { IntegracaoPanel } from './integracao-panel'

const TIPOS_DEFEITO = ['SMD', 'PTH', 'Integração', 'TOP', 'BOT', 'Funcional', 'Elétrico']
const OPCOES_STATUS = ['Aprovado', 'Reprovado']
// Paridade com o legado (Código.gs): NQA Funcional também aceita "Não aplicável" (conta como aprovado).
const OPCOES_NQA_FUNCIONAL = ['Aprovado', 'Reprovado', 'Não aplicável']

interface DefeitoLinha {
  codigo: string
  posicao: string
  tipo: string
}

export function LancamentoForm({
  ordens,
  defeitos,
  postosPerfil,
}: {
  ordens: OrdemLancamentoLista[]
  defeitos: { codigo: string; tipo: number }[]
  postosPerfil: Record<string, PerfilPosto>
}) {
  const [colaborador, setColaborador] = useState('')
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [posto, setPosto] = useState('')
  const [numeroSerie, setNumeroSerie] = useState('')
  const [status, setStatus] = useState('')
  const [numeroCaixa, setNumeroCaixa] = useState('')
  const [qtdPorCaixa, setQtdPorCaixa] = useState('')
  const [nqaVisual, setNqaVisual] = useState('')
  const [nqaFuncional, setNqaFuncional] = useState('')
  const [defeitosSel, setDefeitosSel] = useState<DefeitoLinha[]>([{ codigo: '', posicao: '', tipo: '' }])
  const [posicoesSPI, setPosicoesSPI] = useState<string[]>([''])
  const [burninEvento, setBurninEvento] = useState<'entrada' | 'saida'>('entrada')
  const [bipeCab, setBipeCab] = useState('')
  const [enviando, startTransition] = useTransition()
  const snRef = useRef<HTMLInputElement>(null)
  const bipeCabRef = useRef<HTMLInputElement>(null)
  const { confirmar, dialog } = useConfirmacao()

  const ordemSel = useMemo(
    () => ordens.find((o) => o.cliente === cliente && o.pmo === pmo && o.op === op) ?? null,
    [ordens, cliente, pmo, op],
  )
  const perfilDo = (p: string) => postosPerfil[p] ?? PERFIL_PADRAO

  const postosDaOp = ordemSel?.postos ?? []

  const comStatus = posto !== '' && perfilTemStatus(perfilDo(posto))
  const ehNqa = perfilDo(posto).recurso === 'nqa'
  const ehSpi = perfilDo(posto).reprova === 'posicoes'
  const ehEmbalagem = perfilDo(posto).recurso === 'caixa'
  const ehBurnin = perfilDo(posto).recurso === 'burnin'
  const ehIntegracao = posto !== '' && perfilDo(posto).recurso === 'integracao'
  // No Burn-in, status/defeitos só valem na saída (entrada é neutra).
  const mostraStatus = comStatus && !ehNqa && (!ehBurnin || burninEvento === 'saida')
  const reprovado = status.toLowerCase() === 'reprovado'
  const semFaixa = ordemSel !== null && (ordemSel.sn_ini.trim() === '' || ordemSel.sn_fim.trim() === '')

  /** Limpa todos os campos dinâmicos da peça (evita dado velho ao trocar contexto/posto). */
  function resetCamposDinamicos() {
    setStatus(''); setDefeitosSel([{ codigo: '', posicao: '', tipo: '' }]); setPosicoesSPI([''])
    setNqaVisual(''); setNqaFuncional(''); setNumeroCaixa(''); setQtdPorCaixa(''); setBurninEvento('entrada')
  }
  /** Trocar entrada/saída limpa o status/defeitos (evita defeito velho da saída ao voltar p/ entrada). */
  function mudarBurninEvento(v: 'entrada' | 'saida') {
    setBurninEvento(v)
    setStatus(''); setDefeitosSel([{ codigo: '', posicao: '', tipo: '' }]); setPosicoesSPI([''])
  }
  function mudarPosto(v: string) {
    setPosto(v); resetCamposDinamicos()
  }
  function onBiparCabecalho() {
    if (bipeCab.trim() === '') return
    const r = resolverOpPorSn(ordens, bipeCab)
    if (!r.ok) {
      toast.error(r.erro === 'SEM_OP' ? 'SN não encontrado em nenhuma OP.' : 'SN cai em mais de uma OP.')
      bipeCabRef.current?.select()
      return
    }
    setCliente(r.ordem.cliente)
    setPmo(r.ordem.pmo)
    setOp(r.ordem.op)
    if (!r.ordem.postos.includes(posto)) setPosto('') // posto persiste se valer na nova OP; senão, re-escolher
    resetCamposDinamicos()
    setBipeCab('')
    setTimeout(() => snRef.current?.focus(), 0)
  }
  function atualizarCabecalho() {
    setCliente(''); setPmo(''); setOp('')
    setNumeroSerie(''); resetCamposDinamicos()
    setBipeCab('')
    setTimeout(() => bipeCabRef.current?.focus(), 0)
  }

  const valido = useMemo(() => {
    if (!colaborador.trim() || !cliente || !pmo || !op || !posto || numeroSerie.trim() === '') return false
    if (!ordemSel || semFaixa) return false
    if (!serieDentroDaFaixa(ordemSel.sn_ini, ordemSel.sn_fim, numeroSerie)) return false
    if (ehEmbalagem && (numeroCaixa.trim() === '' || !Number.isInteger(Number(qtdPorCaixa)) || Number(qtdPorCaixa) <= 0)) return false
    if (ehNqa && (nqaVisual === '' || nqaFuncional === '')) return false
    if (mostraStatus && status === '') return false
    if (mostraStatus && reprovado) {
      if (ehSpi) return posicoesSPI.some((p) => p.trim() !== '')
      // servidor exige código E posição E tipo em ao menos um defeito
      return defeitosSel.some((d) => d.codigo.trim() !== '' && d.posicao.trim() !== '' && d.tipo.trim() !== '')
    }
    return true
  }, [colaborador, cliente, pmo, op, posto, numeroSerie, ordemSel, semFaixa, ehEmbalagem, numeroCaixa, qtdPorCaixa, ehNqa, nqaVisual, nqaFuncional, mostraStatus, status, reprovado, ehSpi, posicoesSPI, defeitosSel])

  function limparPeca() {
    setNumeroSerie(''); setStatus(''); setNqaVisual(''); setNqaFuncional('')
    setDefeitosSel([{ codigo: '', posicao: '', tipo: '' }]); setPosicoesSPI([''])
    setTimeout(() => snRef.current?.focus(), 0)
  }

  async function onEnviar() {
    if (!valido || enviando) return
    // Aviso de tempo mínimo de Burn-in (só na saída; não trava).
    if (ehBurnin && burninEvento === 'saida' && (ordemSel?.tempoBurninPorPosto?.[posto] ?? 0) > 0) {
      const entradaIso = await buscarEntradaBurnin(pmo, op, numeroSerie, posto)
      if (entradaIso) {
        const decorridoMin = (Date.now() - Date.parse(entradaIso)) / 60000
        const min = ordemSel!.tempoBurninPorPosto[posto]!
        if (decorridoMin < min) {
          const faltam = formatarDuracao(Math.max(1, Math.ceil(min - decorridoMin)))
          const ok = await confirmar({
            titulo: 'Sair antes do tempo mínimo de Burn-in?',
            descricao: `Faltavam ${faltam} para o mínimo. Registrar a saída mesmo assim?`,
            rotuloConfirmar: 'Registrar saída',
          })
          if (!ok) return
        }
      }
    }
    startTransition(async () => {
      const r = await lancar({
        colaborador,
        posto,
        pmo,
        op,
        numeroSerie,
        status: mostraStatus ? status : undefined,
        burninEvento: ehBurnin ? burninEvento : undefined,
        numeroCaixa: ehEmbalagem ? numeroCaixa : undefined,
        qtdPorCaixa: ehEmbalagem ? qtdPorCaixa : undefined,
        nqaVisual: ehNqa ? nqaVisual : undefined,
        nqaFuncional: ehNqa ? nqaFuncional : undefined,
        defeitos:
          reprovado && !ehSpi
            ? defeitosSel.filter((d) => d.codigo.trim() !== '' && d.posicao.trim() !== '' && d.tipo.trim() !== '')
            : undefined,
        posicoesSPI: reprovado && ehSpi ? posicoesSPI.filter((p) => p.trim() !== '') : undefined,
      })
      if (r.ok) {
        toast.success(
          ehEmbalagem && r.caixaCount != null
            ? `Registrado. Peças na caixa ${numeroCaixa}: ${r.caixaCount}`
            : 'Registrado.',
        )
        limparPeca()
      } else {
        toast.error(r.erro)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Contexto */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Contexto</CardTitle>
          {op !== '' && (
            <Button variant="outline" size="sm" onClick={atualizarCabecalho}>Atualizar cabeçalho</Button>
          )}
        </CardHeader>
        {op === '' ? (
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="bipeCab">Bipe o Nº de Série para carregar a OP</Label>
            <Input
              id="bipeCab"
              ref={bipeCabRef}
              value={bipeCab}
              onChange={(e) => setBipeCab(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBiparCabecalho() } }}
              placeholder="Bipe ou digite o SN e Enter"
              autoComplete="off"
              autoFocus
              className="h-12 text-lg"
            />
            <p className="text-xs text-muted-foreground">Digitar + Enter também funciona (sem scanner).</p>
          </CardContent>
        ) : (
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="colaborador">Colaborador</Label>
              <Input id="colaborador" value={colaborador} onChange={(e) => setColaborador(e.target.value)} autoComplete="off" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Cliente</Label>
              <Input value={cliente} readOnly disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>PMO</Label>
              <Input value={pmo} readOnly disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>OP</Label>
              <Input value={op} readOnly disabled />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Posto</Label>
              <Select value={posto} onValueChange={(v) => mudarPosto(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{postosDaOp.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Descrição</Label>
              <Input value={ordemSel?.descricao ?? ''} readOnly disabled />
            </div>
            {ehEmbalagem && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="caixa">Nº da Caixa</Label>
                  <Input id="caixa" value={numeroCaixa} onChange={(e) => setNumeroCaixa(e.target.value)} autoComplete="off" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qtdcaixa">Qtd por caixa</Label>
                  <Input id="qtdcaixa" type="number" min="1" step="1" value={qtdPorCaixa} onChange={(e) => setQtdPorCaixa(e.target.value)} />
                </div>
              </>
            )}
            {semFaixa && (
              <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3">Esta OP não tem faixa de Nº de Série cadastrada — não é possível lançar.</p>
            )}
          </CardContent>
        )}
      </Card>

      {ehIntegracao && (
        <IntegracaoPanel
          colaborador={colaborador}
          cliente={cliente}
          pmo={pmo}
          op={op}
          posto={posto}
          descricao={ordemSel?.descricao ?? ''}
          componentes={ordemSel?.receitaPorPosto?.[posto] ?? []}
        />
      )}

      {/* Bipagem */}
      {!ehIntegracao && (
      <Card>
        <CardHeader>
          <CardTitle>Peça</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sn">Nº de Série</Label>
            <Input
              id="sn"
              ref={snRef}
              value={numeroSerie}
              onChange={(e) => setNumeroSerie(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnviar() } }}
              autoComplete="off"
              autoFocus
              className="h-12 text-lg"
              placeholder="Bipe o Nº de Série"
            />
          </div>

          {ehBurnin && (
            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label>Evento</Label>
              <Select value={burninEvento} onValueChange={(v) => mudarBurninEvento((v ?? 'entrada') as 'entrada' | 'saida')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {mostraStatus && (
            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{OPCOES_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {ehNqa && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-lg">
              <div className="flex flex-col gap-1.5">
                <Label>Inspeção Visual</Label>
                <Select value={nqaVisual} onValueChange={(v) => setNqaVisual(v ?? '')}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{OPCOES_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Inspeção Funcional</Label>
                <Select value={nqaFuncional} onValueChange={(v) => setNqaFuncional(v ?? '')}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{OPCOES_NQA_FUNCIONAL.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* SPI reprovado → posições */}
          {mostraStatus && ehSpi && reprovado && (
            <div className="flex flex-col gap-2">
              <Label>Posições reprovadas</Label>
              {posicoesSPI.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={p}
                    onChange={(e) => setPosicoesSPI(posicoesSPI.map((x, idx) => (idx === i ? e.target.value : x)))}
                    placeholder="Posição"
                    className="sm:max-w-xs"
                  />
                  <button type="button" aria-label="Remover posição" onClick={() => setPosicoesSPI(posicoesSPI.length > 1 ? posicoesSPI.filter((_, idx) => idx !== i) : posicoesSPI)} className="text-muted-foreground hover:text-red-600 disabled:opacity-30" disabled={posicoesSPI.length <= 1}>
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setPosicoesSPI([...posicoesSPI, ''])} className="self-start text-sm font-medium text-enterplak hover:underline">
                <Plus className="mr-1 inline size-4" /> Adicionar posição
              </button>
            </div>
          )}

          {/* Demais reprovado → defeitos múltiplos */}
          {mostraStatus && !ehSpi && reprovado && (
            <div className="flex flex-col gap-2">
              <Label>Defeitos</Label>
              <datalist id="defeitos-list">
                {defeitos.map((d) => <option key={d.codigo} value={d.codigo} />)}
              </datalist>
              {defeitosSel.map((d, i) => (
                <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Input list="defeitos-list" value={d.codigo} onChange={(e) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, codigo: e.target.value } : x)))} placeholder="Código" />
                  <Input value={d.posicao} onChange={(e) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, posicao: e.target.value } : x)))} placeholder="Posição" />
                  <Select value={d.tipo} onValueChange={(v) => setDefeitosSel(defeitosSel.map((x, idx) => (idx === i ? { ...x, tipo: v ?? '' } : x)))}>
                    <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent>{TIPOS_DEFEITO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <button type="button" aria-label="Remover defeito" onClick={() => setDefeitosSel(defeitosSel.length > 1 ? defeitosSel.filter((_, idx) => idx !== i) : defeitosSel)} className="pb-2 text-muted-foreground hover:text-red-600 disabled:opacity-30" disabled={defeitosSel.length <= 1}>
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setDefeitosSel([...defeitosSel, { codigo: '', posicao: '', tipo: '' }])} className="self-start text-sm font-medium text-enterplak hover:underline">
                <Plus className="mr-1 inline size-4" /> Adicionar defeito
              </button>
            </div>
          )}

          <div>
            <Button onClick={onEnviar} disabled={!valido || enviando} className="h-11 bg-enterplak px-8 hover:bg-enterplak-700">
              {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}
      {dialog}
    </div>
  )
}
