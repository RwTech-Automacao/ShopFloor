'use client'

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { carregarSetupAction, consultarAlteracoes, consultarSetups } from '@/modules/setup/application/setup-actions'
import { FACES } from '@/modules/setup/domain/face'
import { rotulosPosicao, type Processo } from '@/modules/setup/domain/tipos'
import type { Alteracao, Equipamento, FiltroSetups, ItemSetup, SetupResumo } from '@/modules/setup/infra/setup-repository'
import { rotuloEquipamento } from '../../selecao-setup'

// Sentinela: o Select não aceita item com value="" (usado internamente para "nenhuma seleção").
const TODOS = '__todos__'

const ROTULO_TIPO: Record<string, string> = {
  troca_feeder: 'Troca de feeder',
  troca_posicao: 'Troca de posição',
  correcao: 'Correção',
  inclusao: 'Inclusão',
  remocao: 'Remoção',
}

const ROTULO_ESTADO: Record<SetupResumo['estado'], string> = { montagem: 'Em montagem', liberado: 'Liberado' }

function fmtData(iso: string | null): string {
  if (!iso) return '—'
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

/** Marca a 1ª ocorrência de `termo` dentro de `texto` (busca rápida local do diálogo). */
function destacar(texto: string, termo: string): ReactNode {
  if (!termo) return texto
  const idx = texto.toLowerCase().indexOf(termo.toLowerCase())
  if (idx === -1) return texto
  return (
    <>
      {texto.slice(0, idx)}
      <mark className="rounded bg-amber-200 px-0.5">{texto.slice(idx, idx + termo.length)}</mark>
      {texto.slice(idx + termo.length)}
    </>
  )
}

/** "posição/feeder" de um lado (antes ou depois) de uma alteração — null quando o item não existia (inclusão/remoção). */
function ladoAlteracao(o: Record<string, unknown> | null): string {
  if (!o) return '—'
  const pos = o.posicao != null ? String(o.posicao) : ''
  const fee = o.feeder != null ? String(o.feeder) : ''
  return `${pos}/${fee}`
}

export function SetupsConsulta({ equipamentos }: { equipamentos: Equipamento[] }) {
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [processo, setProcesso] = useState('')
  const [linha, setLinha] = useState('')
  const [equipamento, setEquipamento] = useState('')
  const [face, setFace] = useState('')
  const [estado, setEstado] = useState('')

  const [setups, setSetups] = useState<SetupResumo[]>([])
  const [carregando, setCarregando] = useState(false)
  const [buscou, setBuscou] = useState(false)
  // Descarta a resposta de uma consulta antiga se o usuário já disparou outra (ou limpou os filtros).
  const seqRef = useRef(0)

  const [dialogSetup, setDialogSetup] = useState<SetupResumo | null>(null)
  const [itensDialog, setItensDialog] = useState<ItemSetup[]>([])
  const [alteracoes, setAlteracoes] = useState<Alteracao[]>([])
  const [carregandoDialog, setCarregandoDialog] = useState(false)
  const [buscaLocal, setBuscaLocal] = useState('')
  const dialogSeqRef = useRef(0)

  const equipamentosDoProcesso = useMemo(
    () => (processo ? equipamentos.filter((e) => e.processo === processo) : equipamentos),
    [equipamentos, processo],
  )
  const linhas = useMemo(
    () => [...new Set(equipamentosDoProcesso.map((e) => e.linha))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [equipamentosDoProcesso],
  )
  const maquinas = useMemo(
    () => (linha ? equipamentosDoProcesso.filter((e) => e.linha === linha) : equipamentosDoProcesso),
    [equipamentosDoProcesso, linha],
  )
  const rotuloCampoMaquina = processo ? rotulosPosicao(processo as Processo).equipamento : 'Máquina/Bloco'

  function mudarProcesso(v: string) {
    setProcesso(v)
    setLinha('')
    setEquipamento('')
  }
  function mudarLinha(v: string) {
    setLinha(v)
    setEquipamento('')
  }

  function consultar(e?: FormEvent) {
    e?.preventDefault()
    const filtro: FiltroSetups = {
      pmo: pmo.trim() || undefined,
      op: op.trim() || undefined,
      processo: processo || undefined,
      linha: linha || undefined,
      equipamento: equipamento || undefined,
      face: face || undefined,
      estado: estado || undefined,
    }
    const seq = ++seqRef.current
    setCarregando(true)
    void (async () => {
      try {
        const r = await consultarSetups(filtro)
        if (seq !== seqRef.current) return
        if (!r.ok) { toast.error(r.erro); setSetups([]) }
        else setSetups(r.setups)
      } catch {
        if (seq === seqRef.current) { toast.error('Não foi possível consultar. Verifique a conexão.'); setSetups([]) }
      } finally {
        if (seq === seqRef.current) { setCarregando(false); setBuscou(true) }
      }
    })()
  }

  function limpar() {
    seqRef.current++ // qualquer resposta que ainda volte é descartada
    setPmo(''); setOp(''); setProcesso(''); setLinha(''); setEquipamento(''); setFace(''); setEstado('')
    setSetups([])
    setCarregando(false)
    setBuscou(false)
  }

  function abrirDialog(s: SetupResumo) {
    setDialogSetup(s)
    setBuscaLocal('')
    setItensDialog([])
    setAlteracoes([])
    const seq = ++dialogSeqRef.current
    setCarregandoDialog(true)
    void (async () => {
      try {
        const [ri, ra] = await Promise.all([carregarSetupAction(s.id), consultarAlteracoes(s.id)])
        if (seq !== dialogSeqRef.current) return
        if (!ri.ok) toast.error(ri.erro)
        else setItensDialog(ri.itens)
        if (!ra.ok) toast.error(ra.erro)
        else setAlteracoes(ra.alteracoes)
      } catch {
        if (seq === dialogSeqRef.current) toast.error('Não foi possível carregar o setup. Verifique a conexão.')
      } finally {
        if (seq === dialogSeqRef.current) setCarregandoDialog(false)
      }
    })()
  }

  function fecharDialog(aberto: boolean) {
    if (aberto) return
    dialogSeqRef.current++ // fechou antes da resposta chegar: ignora quando ela chegar
    setDialogSetup(null)
  }

  const termo = buscaLocal.trim()
  const itensFiltrados = useMemo(() => {
    if (!termo) return itensDialog
    const alvo = termo.toLowerCase()
    return itensDialog.filter((i) =>
      i.posicao.toLowerCase().includes(alvo)
      || i.feeder.toLowerCase().includes(alvo)
      || i.componente.toLowerCase().includes(alvo)
      || (i.rolo ?? '').toLowerCase().includes(alvo),
    )
  }, [itensDialog, termo])

  const rotulosDialog = dialogSetup ? rotulosPosicao(dialogSetup.processo) : null

  return (
    <div className="flex flex-col gap-4 pt-4">
      <form onSubmit={consultar} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-pmo">PMO</Label>
          <Input id="f-pmo" value={pmo} onChange={(e) => setPmo(e.target.value)} className="w-32" placeholder="PMO" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-op">OP</Label>
          <Input id="f-op" value={op} onChange={(e) => setOp(e.target.value)} className="w-28" placeholder="OP" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-processo">Processo</Label>
          <Select value={processo || TODOS} onValueChange={(v) => mudarProcesso(v === TODOS ? '' : String(v))}>
            <SelectTrigger id="f-processo" className="w-28">
              <SelectValue placeholder="Todos">{(v: string | null) => (!v || v === TODOS ? 'Todos' : String(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="SMD">SMD</SelectItem>
              <SelectItem value="PTH">PTH</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-linha">Linha</Label>
          <Select value={linha || TODOS} onValueChange={(v) => mudarLinha(v === TODOS ? '' : String(v))}>
            <SelectTrigger id="f-linha" className="w-32">
              <SelectValue placeholder="Todas">{(v: string | null) => (!v || v === TODOS ? 'Todas' : `Linha ${v}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {linhas.map((l) => <SelectItem key={l} value={l}>Linha {l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-equipamento">{rotuloCampoMaquina}</Label>
          <Select value={equipamento || TODOS} onValueChange={(v) => setEquipamento(v === TODOS ? '' : String(v))}>
            <SelectTrigger id="f-equipamento" className="w-40">
              <SelectValue placeholder="Todos">
                {(v: string | null) => {
                  if (!v || v === TODOS) return 'Todos'
                  const e = maquinas.find((m) => m.equipamento === v)
                  return e ? rotuloEquipamento(e.processo, e.equipamento) : v
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {maquinas.map((m) => <SelectItem key={m.id} value={m.equipamento}>{rotuloEquipamento(m.processo, m.equipamento)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-face">Face</Label>
          <Select value={face || TODOS} onValueChange={(v) => setFace(v === TODOS ? '' : String(v))}>
            <SelectTrigger id="f-face" className="w-32">
              <SelectValue placeholder="Todas">{(v: string | null) => (!v || v === TODOS ? 'Todas' : String(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {FACES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-estado">Estado</Label>
          <Select value={estado || TODOS} onValueChange={(v) => setEstado(v === TODOS ? '' : String(v))}>
            <SelectTrigger id="f-estado" className="w-36">
              <SelectValue placeholder="Todos">
                {(v: string | null) => (!v || v === TODOS ? 'Todos' : ROTULO_ESTADO[v as SetupResumo['estado']])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="montagem">Em montagem</SelectItem>
              <SelectItem value="liberado">Liberado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="bg-enterplak hover:bg-enterplak-700" disabled={carregando}>Consultar</Button>
          <Button type="button" variant="outline" onClick={limpar} disabled={carregando}>Limpar filtros</Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>OP</TableHead>
              <TableHead>PMO</TableHead>
              <TableHead>Processo</TableHead>
              <TableHead>Linha</TableHead>
              <TableHead>Máquina/Bloco</TableHead>
              <TableHead>Face</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Posições (sem rolo)</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead>Liberado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {carregando && (
              <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Consultando…</TableCell></TableRow>
            )}
            {!carregando && buscou && setups.length === 0 && (
              <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Nenhum setup encontrado com esses filtros.</TableCell></TableRow>
            )}
            {!carregando && !buscou && (
              <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Use os filtros e clique em Consultar.</TableCell></TableRow>
            )}
            {!carregando && setups.map((s) => (
              <TableRow key={s.id} onClick={() => abrirDialog(s)} className="cursor-pointer hover:bg-accent/60" title="Toque para ver os detalhes do setup">
                <TableCell className="font-medium">{s.op}</TableCell>
                <TableCell>{s.pmo}</TableCell>
                <TableCell>{s.processo}</TableCell>
                <TableCell>{s.linha}</TableCell>
                <TableCell>{rotuloEquipamento(s.processo, s.equipamento)}</TableCell>
                <TableCell>{s.face}</TableCell>
                <TableCell><BadgeEstado estado={s.estado} /></TableCell>
                <TableCell>
                  {s.totalItens} <span className={s.semRolo > 0 ? 'font-medium text-amber-700' : 'text-muted-foreground'}>({s.semRolo} sem rolo)</span>
                </TableCell>
                <TableCell>{fmtData(s.criadoEm)}</TableCell>
                <TableCell>{fmtData(s.liberadoEm)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogSetup !== null} onOpenChange={fecharDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[min(64rem,calc(100%-2rem))]">
          {dialogSetup && rotulosDialog && (
            <>
              <DialogHeader>
                <DialogTitle>
                  OP {dialogSetup.pmo}/{dialogSetup.op} · Linha {dialogSetup.linha} · {rotuloEquipamento(dialogSetup.processo, dialogSetup.equipamento)} · {dialogSetup.face}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>{dialogSetup.processo} · SN de Abertura <span className="font-mono text-foreground">{dialogSetup.snAbertura}</span></span>
                <BadgeEstado estado={dialogSetup.estado} />
                <span>Criado em {fmtData(dialogSetup.criadoEm)}</span>
                <span>Liberado em {fmtData(dialogSetup.liberadoEm)}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="busca-local">Buscar posição, feeder, componente ou rolo</Label>
                <Input id="busca-local" value={buscaLocal} onChange={(e) => setBuscaLocal(e.target.value)} autoComplete="off" placeholder="Digite para filtrar…" />
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{rotulosDialog.posicao}</TableHead>
                      <TableHead>{rotulosDialog.feeder}</TableHead>
                      <TableHead>Componente</TableHead>
                      <TableHead>Rolo montado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {carregandoDialog && (
                      <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Carregando…</TableCell></TableRow>
                    )}
                    {!carregandoDialog && itensFiltrados.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Nenhum item encontrado.</TableCell></TableRow>
                    )}
                    {!carregandoDialog && itensFiltrados.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-medium">{destacar(i.posicao, termo)}</TableCell>
                        <TableCell>{destacar(i.feeder, termo)}</TableCell>
                        <TableCell className="font-mono">{destacar(i.componente, termo)}</TableCell>
                        <TableCell className="font-mono">{i.rolo ? destacar(i.rolo, termo) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Histórico de alterações</h3>
                {!carregandoDialog && alteracoes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma alteração.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Antes → Depois ({rotulosDialog.posicao.toLowerCase()}/{rotulosDialog.feeder.toLowerCase()})</TableHead>
                          <TableHead>Usuário</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {carregandoDialog && (
                          <TableRow><TableCell colSpan={4} className="py-4 text-center text-muted-foreground">Carregando…</TableCell></TableRow>
                        )}
                        {!carregandoDialog && alteracoes.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell>{fmtData(a.dataHora)}</TableCell>
                            <TableCell>{ROTULO_TIPO[a.tipo] ?? a.tipo}</TableCell>
                            <TableCell className="font-mono">{ladoAlteracao(a.antes)} → {ladoAlteracao(a.depois)}</TableCell>
                            <TableCell>{a.usuarioNome}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
