'use client'

import { useRef, useState, useTransition, type RefObject } from 'react'
import Link from 'next/link'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { PainelResultado, type ChipResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { tocarErro } from '@/shared/lib/som-erro'
import {
  abrirSetup,
  carregarSetupAction,
  editarItem,
  incluirItem,
  liberarSetup,
  localizarSetup,
  removerItem,
  setupsParaCopiar,
} from '@/modules/setup/application/setup-actions'
import { separarRolo } from '@/modules/setup/domain/codigo-rolo'
import { mensagemErroSetup } from '@/modules/setup/domain/mensagens'
import { rotuloEquipamento, rotulosPosicao } from '@/modules/setup/domain/tipos'
import type { Equipamento, ItemSetup, OrdemSetup, SetupResumo } from '@/modules/setup/infra/setup-repository'
import { chaveDaSelecao, SELECAO_VAZIA, SelecaoSetup, selecaoCompleta, type ValorSelecao } from '../../selecao-setup'

const INPUT_BIPE = 'h-11 text-lg uppercase'

function fmtData(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function BadgeEstado({ estado }: { estado: SetupResumo['estado'] }) {
  return estado === 'liberado' ? (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">Liberado</span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-medium text-amber-800">Em montagem</span>
  )
}

export function MontarSetup({
  ordens,
  equipamentos,
  podeAdministrar,
}: {
  ordens: OrdemSetup[]
  equipamentos: Equipamento[]
  podeAdministrar: boolean
}) {
  const [selecao, setSelecao] = useState<ValorSelecao>(SELECAO_VAZIA)
  const [setup, setSetup] = useState<SetupResumo | null>(null)
  const [itens, setItens] = useState<ItemSetup[]>([])
  const [buscando, setBuscando] = useState(false)
  const [snAbertura, setSnAbertura] = useState('')
  const [copias, setCopias] = useState<SetupResumo[] | null>(null)
  const [posicao, setPosicao] = useState('')
  const [feeder, setFeeder] = useState('')
  const [rolo, setRolo] = useState('')
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [enviando, startEnvio] = useTransition()
  const [editando, setEditando] = useState<ItemSetup | null>(null)
  const [edPosicao, setEdPosicao] = useState('')
  const [edFeeder, setEdFeeder] = useState('')
  const { confirmar, dialog } = useConfirmacao()

  const posicaoRef = useRef<HTMLInputElement>(null)
  const feederRef = useRef<HTMLInputElement>(null)
  const roloRef = useRef<HTMLInputElement>(null)
  // Evita bipe duplo (scanner manda Enter rápido) enquanto a transição ainda não marcou `enviando`.
  const enviandoRef = useRef(false)
  // Descarta respostas de uma seleção antiga (o operador trocou a máquina antes de a busca voltar).
  const buscaSeq = useRef(0)

  // Sempre seleciona o conteúdo ao focar: o leitor de bipe digita em cima e substitui, em vez de concatenar.
  function focarCampo(ref: RefObject<HTMLInputElement | null>) {
    ref.current?.focus()
    ref.current?.select()
  }

  const completa = selecaoCompleta(selecao)
  const rotulos = rotulosPosicao(setup?.processo ?? (selecao.processo || 'SMD'))
  const semRolo = itens.filter((i) => i.rolo === null).length
  const podeBipar = setup !== null && (setup.estado === 'montagem' || podeAdministrar)

  function avisar(titulo: string, chips?: ChipResultado[]) {
    setResultado({ tipo: 'aviso', titulo, chips })
    tocarErro()
  }

  async function recarregar(id: string): Promise<boolean> {
    try {
      const r = await carregarSetupAction(id)
      if (!r.ok) { avisar(r.erro); return false }
      setSetup(r.setup)
      setItens(r.itens)
      return true
    } catch {
      avisar('Falha de conexão. Não foi possível atualizar a lista.')
      return false
    }
  }

  function mudarSelecao(v: ValorSelecao) {
    setSelecao(v)
    setSetup(null)
    setItens([])
    setCopias(null)
    setResultado(null)
    setSnAbertura('')
    setPosicao(''); setFeeder(''); setRolo('')
    const seq = ++buscaSeq.current
    if (!selecaoCompleta(v)) { setBuscando(false); return }
    setBuscando(true)
    void (async () => {
      try {
        const r = await localizarSetup(chaveDaSelecao(v))
        if (seq !== buscaSeq.current) return
        if (!r.ok) { avisar(r.erro); return }
        if (r.setup) {
          const c = await carregarSetupAction(r.setup.id)
          if (seq !== buscaSeq.current) return
          if (!c.ok) avisar(c.erro)
          else { setSetup(c.setup); setItens(c.itens) }
        }
      } catch {
        // Rede caiu no meio da busca: avisa em vez de deixar a tela presa em "Procurando…".
        if (seq === buscaSeq.current) avisar('Não foi possível procurar o setup. Verifique a conexão, troque a face ou o equipamento e volte pra tentar de novo.')
      } finally {
        if (seq === buscaSeq.current) setBuscando(false)
      }
    })()
  }

  function abrir(copiarDe?: string) {
    if (!selecaoCompleta(selecao) || enviandoRef.current) return
    if (snAbertura.trim() === '') { avisar(mensagemErroSetup('SN_OBRIGATORIO')); return }
    enviandoRef.current = true
    startEnvio(async () => {
      try {
        const r = await abrirSetup({ ...chaveDaSelecao(selecao), snAbertura, copiarDe })
        if (!r.ok) { avisar(r.erro); return }
        if (!(await recarregar(r.setupId))) return
        setCopias(null)
        setResultado(r.semFaixa ? { tipo: 'aviso', titulo: 'OP sem faixa de SN — SN aceito sem conferência' } : null)
        requestAnimationFrame(() => focarCampo(posicaoRef))
      } catch {
        avisar('Falha de conexão. Não foi possível abrir o setup. Tente de novo.')
      } finally {
        enviandoRef.current = false
      }
    })
  }

  function buscarCopias() {
    if (!selecaoCompleta(selecao) || enviandoRef.current) return
    const { pmo, op, equipamentoId, face } = chaveDaSelecao(selecao)
    enviandoRef.current = true
    startEnvio(async () => {
      try {
        const r = await setupsParaCopiar({ pmo, equipamentoId, face, excetoOp: op })
        if (!r.ok) { avisar(r.erro); return }
        setCopias(r.setups)
      } catch {
        avisar('Falha de conexão. Não foi possível buscar os setups anteriores. Tente de novo.')
      } finally {
        enviandoRef.current = false
      }
    })
  }

  function enviar() {
    if (!setup || enviandoRef.current) return
    const pos = posicao.trim(), fee = feeder.trim(), rol = rolo.trim()
    if (pos === '') { focarCampo(posicaoRef); return }
    if (fee === '') { focarCampo(feederRef); return }
    if (rol === '') { focarCampo(roloRef); return }
    const chips: ChipResultado[] = [
      { rotulo: rotulos.posicao, valor: pos },
      { rotulo: rotulos.feeder, valor: fee },
      { rotulo: 'Rolo', valor: rol, mono: true },
    ]
    // Confere o formato do rolo aqui: não gasta uma ida ao servidor com código que já sabemos inválido.
    if (!separarRolo(rol).valido) {
      avisar(mensagemErroSetup('ROLO_INVALIDO'), chips)
      setRolo('')
      focarCampo(roloRef)
      return
    }
    enviandoRef.current = true
    const setupId = setup.id
    startEnvio(async () => {
      try {
        const r = await incluirItem(setupId, pos, fee, rol)
        if (!r.ok) {
          avisar(r.erro, chips)
          setRolo('')
          focarCampo(roloRef)
          return
        }
        setResultado({
          tipo: 'ok',
          titulo: r.atualizou ? 'Rolo bipado no item copiado' : 'Item cadastrado',
          chips: [
            { rotulo: rotulos.posicao, valor: pos },
            { rotulo: rotulos.feeder, valor: fee },
            { rotulo: 'Componente', valor: r.componente, mono: true },
            { rotulo: 'Rolo', valor: rol, mono: true },
          ],
        })
        setPosicao(''); setFeeder(''); setRolo('')
        focarCampo(posicaoRef)
        await recarregar(setupId)
      } catch {
        avisar('Falha de conexão. Confira a lista antes de bipar de novo.', chips)
        await recarregar(setupId)
      } finally {
        enviandoRef.current = false
      }
    })
  }

  async function remover(item: ItemSetup) {
    if (!setup) return
    const ok = await confirmar({
      titulo: `Remover ${rotulos.posicao.toLowerCase()} ${item.posicao}?`,
      descricao: `${rotulos.feeder} ${item.feeder} · componente ${item.componente}${item.rolo ? ` · rolo ${item.rolo}` : ''}`,
      rotuloConfirmar: 'Remover',
    })
    if (!ok) return
    const setupId = setup.id
    startEnvio(async () => {
      try {
        const r = await removerItem(item.id)
        if (!r.ok) { avisar(r.erro); return }
        await recarregar(setupId)
        toast.success(`Item ${item.posicao} removido`, { position: 'bottom-center' })
      } catch {
        toast.error('Falha de conexão. Não foi possível remover. Confira a lista antes de tentar de novo.', { position: 'bottom-center' })
        await recarregar(setupId)
      }
    })
  }

  async function liberar() {
    if (!setup) return
    const ok = await confirmar({
      titulo: 'Liberar o setup?',
      descricao: 'Depois de liberado, só um administrador altera posições e feeders.',
      rotuloConfirmar: 'Liberar setup',
    })
    if (!ok) return
    const setupId = setup.id
    startEnvio(async () => {
      try {
        const r = await liberarSetup(setupId)
        if (!r.ok) { avisar(r.erro); return }
        await recarregar(setupId)
        setResultado(null)
        toast.success('Setup liberado', { position: 'bottom-center' })
      } catch {
        toast.error('Falha de conexão. Confira o estado do setup antes de liberar de novo.', { position: 'bottom-center' })
        await recarregar(setupId)
      }
    })
  }

  function preencherFaltante(item: ItemSetup) {
    if (!podeBipar || item.rolo !== null) return
    setPosicao(item.posicao)
    setFeeder(item.feeder)
    setRolo('')
    focarCampo(roloRef)
  }

  function abrirEdicao(item: ItemSetup) {
    setEditando(item)
    setEdPosicao(item.posicao)
    setEdFeeder(item.feeder)
  }

  function salvarEdicao() {
    if (!setup || !editando) return
    const setupId = setup.id, itemId = editando.id
    startEnvio(async () => {
      try {
        const r = await editarItem(itemId, edPosicao, edFeeder)
        if (!r.ok) { toast.error(r.erro, { position: 'bottom-center' }); return }
        setEditando(null)
        await recarregar(setupId)
        toast.success('Alteração salva', { position: 'bottom-center' })
      } catch {
        toast.error('Falha de conexão. Não foi possível salvar. Confira a lista antes de tentar de novo.', { position: 'bottom-center' })
        await recarregar(setupId)
      }
    })
  }

  const mostrarEdicao = setup?.estado === 'liberado' && podeAdministrar
  const mostrarRemover = setup !== null && (setup.estado === 'montagem' || podeAdministrar)

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <SelecaoSetup ordens={ordens} equipamentos={equipamentos} valor={selecao} onChange={mudarSelecao} desabilitado={enviando} />
      </div>

      {!completa && (
        <p className="text-sm text-muted-foreground">Escolha a OP, o processo, a linha, o bloco (e a máquina, no SMD) e a face para abrir o setup.</p>
      )}

      {completa && buscando && <p className="text-sm text-muted-foreground">Procurando o setup…</p>}

      {completa && !buscando && setup === null && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">Novo setup</h2>
          <PainelResultado resultado={resultado} />
          <div className="flex flex-col gap-1.5 sm:max-w-sm">
            <Label htmlFor="snAbertura">SN de Abertura</Label>
            <Input
              id="snAbertura"
              value={snAbertura}
              onChange={(e) => setSnAbertura(e.target.value)}
              // Enter do scanner não dispara nada: o operador ainda escolhe entre montar do zero ou copiar.
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
              placeholder="Bipe o Nº de Série da primeira placa"
              autoComplete="off"
              autoFocus
              className={INPUT_BIPE}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="h-11 bg-enterplak px-4 text-base hover:bg-enterplak-700" onClick={() => abrir()} disabled={enviando}>
              Montar do zero
            </Button>
            <Button variant="outline" className="h-11 px-4 text-base" onClick={buscarCopias} disabled={enviando}>
              Copiar de uma OP anterior
            </Button>
          </div>

          {copias !== null && (
            copias.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum setup anterior dessa PMO nesse equipamento e face.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {copias.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="flex flex-wrap items-center gap-2 text-base">
                      <span className="font-medium">OP {c.op}</span>
                      <span className="text-muted-foreground">· {fmtData(c.criadoEm)} · {c.totalItens} {c.totalItens === 1 ? 'item' : 'itens'} ·</span>
                      <BadgeEstado estado={c.estado} />
                    </span>
                    <Button variant="outline" className="h-10 px-4" onClick={() => abrir(c.id)} disabled={enviando}>
                      Copiar
                    </Button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}

      {completa && !buscando && setup !== null && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">
                OP {setup.pmo}/{setup.op} · Linha {setup.linha} · {rotuloEquipamento(setup)} · {setup.face}
              </p>
              <p className="text-sm text-muted-foreground">
                {setup.processo} · SN de Abertura <span className="font-mono text-foreground">{setup.snAbertura}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <BadgeEstado estado={setup.estado} />
              <span className="text-sm text-muted-foreground">
                {itens.length} {itens.length === 1 ? 'item' : 'itens'} ·{' '}
                <span className={semRolo > 0 ? 'font-medium text-amber-700' : ''}>{semRolo} sem rolo</span>
              </span>
              {setup.estado === 'montagem' && (
                <Button
                  className="h-11 bg-enterplak px-4 text-base hover:bg-enterplak-700"
                  onClick={liberar}
                  disabled={enviando || itens.length === 0 || semRolo > 0}
                >
                  Liberar setup
                </Button>
              )}
            </div>
          </div>

          <PainelResultado resultado={resultado} />

          {podeBipar && (
            <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bipePosicao">{rotulos.posicao}</Label>
                <Input
                  id="bipePosicao"
                  ref={posicaoRef}
                  value={posicao}
                  onChange={(e) => setPosicao(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focarCampo(feederRef) } }}
                  autoComplete="off"
                  autoFocus
                  className={INPUT_BIPE}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bipeFeeder">{rotulos.feeder}</Label>
                <Input
                  id="bipeFeeder"
                  ref={feederRef}
                  value={feeder}
                  onChange={(e) => setFeeder(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focarCampo(roloRef) } }}
                  autoComplete="off"
                  className={INPUT_BIPE}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bipeRolo">Código Componente</Label>
                <Input
                  id="bipeRolo"
                  ref={roloRef}
                  value={rolo}
                  onChange={(e) => setRolo(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enviar() } }}
                  placeholder="CÓDIGO-LOTE"
                  autoComplete="off"
                  className={INPUT_BIPE}
                />
              </div>
            </div>
          )}

          {!podeBipar && (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
              <p className="text-base font-semibold">Setup liberado. Troca de rolo é feita em Abastecimento.</p>
              <p className="mt-1 text-sm">
                <Link href="/setup/operar/abastecimento" className="font-medium underline underline-offset-2">Ir para Abastecimento</Link>
              </p>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{rotulos.posicao}</TableHead>
                  <TableHead>{rotulos.feeder}</TableHead>
                  <TableHead>Componente</TableHead>
                  <TableHead>Rolo montado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Nenhum item cadastrado. Bipe {rotulos.posicao.toLowerCase()}, {rotulos.feeder.toLowerCase()} e rolo.
                    </TableCell>
                  </TableRow>
                )}
                {itens.map((i) => {
                  const falta = i.rolo === null
                  const clicavel = falta && podeBipar
                  return (
                    <TableRow
                      key={i.id}
                      onClick={clicavel ? () => preencherFaltante(i) : undefined}
                      className={`text-base ${clicavel ? 'cursor-pointer bg-amber-50/60 hover:bg-amber-100/60' : ''}`}
                      title={clicavel ? 'Toque para bipar o rolo deste item' : undefined}
                    >
                      <TableCell className="font-medium">{i.posicao}</TableCell>
                      <TableCell>{i.feeder}</TableCell>
                      <TableCell className="font-mono">{i.componente}</TableCell>
                      <TableCell className="font-mono">
                        {falta ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 font-sans text-sm font-medium text-amber-800">
                            falta bipar o rolo
                          </span>
                        ) : i.rolo}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {mostrarEdicao && (
                            <Button
                              variant="ghost"
                              size="icon-lg"
                              aria-label={`Editar ${rotulos.posicao.toLowerCase()} ${i.posicao}`}
                              onClick={(e) => { e.stopPropagation(); abrirEdicao(i) }}
                              disabled={enviando}
                            >
                              <PencilIcon />
                            </Button>
                          )}
                          {mostrarRemover && (
                            <Button
                              variant="ghost"
                              size="icon-lg"
                              aria-label={`Remover ${rotulos.posicao.toLowerCase()} ${i.posicao}`}
                              onClick={(e) => { e.stopPropagation(); void remover(i) }}
                              disabled={enviando}
                            >
                              <Trash2Icon />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={editando !== null} onOpenChange={(v) => { if (!v) setEditando(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar {rotulos.posicao.toLowerCase()} {editando?.posicao}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edPosicao">{rotulos.posicao}</Label>
              <Input id="edPosicao" value={edPosicao} onChange={(e) => setEdPosicao(e.target.value)} autoComplete="off" className={INPUT_BIPE} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edFeeder">{rotulos.feeder}</Label>
              <Input id="edFeeder" value={edFeeder} onChange={(e) => setEdFeeder(e.target.value)} autoComplete="off" className={INPUT_BIPE} />
            </div>
            <p className="text-sm text-muted-foreground">A alteração fica registrada no histórico do setup.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button className="bg-enterplak hover:bg-enterplak-700" onClick={salvarEdicao} disabled={enviando}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog}
    </div>
  )
}
