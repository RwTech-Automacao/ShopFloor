'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Wrench, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollHorizontalTopo } from '@/shared/ui/scroll-horizontal-topo'
import { registrarReparo } from '@/modules/shopfloor/application/manutencao-actions'
import type { Ocorrencia } from '@/modules/shopfloor/domain/manutencao-pendencias'

interface Conserto {
  descricao: string
  posicao: string
}

export function ManutencaoLista({
  ocorrencias,
  defeitosCatalogo,
}: {
  ocorrencias: Ocorrencia[]
  defeitosCatalogo: string[]
}) {
  const router = useRouter()
  const [fCliente, setFCliente] = useState('')
  const [fStatus, setFStatus] = useState('Pendente')
  const [fSn, setFSn] = useState('')
  const [alvo, setAlvo] = useState<Ocorrencia | null>(null)
  const [colaborador, setColaborador] = useState('')
  const [consertos, setConsertos] = useState<Conserto[]>([{ descricao: '', posicao: '' }])
  const [constatados, setConstatados] = useState<string[]>([''])
  const [salvando, startTransition] = useTransition()

  const clientes = useMemo(() => [...new Set(ocorrencias.map((o) => o.cliente).filter(Boolean))], [ocorrencias])

  const filtradas = useMemo(
    () =>
      ocorrencias.filter((o) => {
        if (fCliente !== '' && o.cliente !== fCliente) return false
        if (fStatus !== '' && o.status !== fStatus) return false
        if (fSn.trim() !== '' && !o.sn.toLowerCase().includes(fSn.trim().toLowerCase())) return false
        return true
      }),
    [ocorrencias, fCliente, fStatus, fSn],
  )

  function abrirReparo(o: Ocorrencia) {
    setAlvo(o)
    setColaborador('')
    setConsertos([{ descricao: '', posicao: '' }])
    setConstatados([''])
  }

  const valido =
    colaborador.trim() !== '' &&
    consertos.some((c) => c.descricao.trim() !== '') &&
    constatados.some((c) => c.trim() !== '')

  function onSalvar() {
    if (!alvo || !valido || salvando) return
    startTransition(async () => {
      const r = await registrarReparo({
        colaborador,
        ocorrencia: {
          pmo: alvo.pmo,
          op: alvo.op,
          sn: alvo.sn,
          posto: alvo.posto,
          dataHora: alvo.dataHora,
          cod: alvo.cod,
          pos: alvo.posicoes.join(', '),
          tipo: alvo.tipo,
        },
        consertos,
        defeitosConstatados: constatados,
      })
      if (r.ok) {
        toast.success('Reparo registrado.')
        setAlvo(null)
        router.refresh()
      } else {
        toast.error(r.erro)
      }
    })
  }

  function fmtData(iso: string) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
        <div className="flex flex-col gap-1.5">
          <Label>Cliente</Label>
          <Select
            value={fCliente === '' ? '__todos__' : fCliente}
            onValueChange={(v) => setFCliente(v === '__todos__' ? '' : (v ?? ''))}
          >
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos</SelectItem>
              {clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select
            value={fStatus === '' ? '__todos__' : fStatus}
            onValueChange={(v) => setFStatus(v === '__todos__' ? '' : (v ?? ''))}
          >
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todas</SelectItem>
              <SelectItem value="Pendente">Pendentes</SelectItem>
              <SelectItem value="Concluída">Concluídas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fsn">Nº de Série</Label>
          <Input id="fsn" value={fSn} onChange={(e) => setFSn(e.target.value)} placeholder="Filtrar por SN" autoComplete="off" />
        </div>
      </div>

      {/* Lista */}
      <ScrollHorizontalTopo>
        <Table containerClassName="rounded-lg border border-border">
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>PMO/OP</TableHead>
              <TableHead>Nº de Série</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Defeito</TableHead>
              <TableHead>Posições</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((o, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{fmtData(o.dataHora)}</TableCell>
                <TableCell>{o.cliente}</TableCell>
                <TableCell>{o.pmo}/{o.op}</TableCell>
                <TableCell className="font-medium">{o.sn}</TableCell>
                <TableCell>{o.posto}</TableCell>
                <TableCell className="max-w-[180px] truncate">{[o.cod, o.tipo].filter(Boolean).join(' · ') || '—'}</TableCell>
                <TableCell>{o.posicoes.join(', ') || '—'}</TableCell>
                <TableCell>
                  <span className={o.status === 'Pendente' ? 'font-medium text-red-600' : 'text-muted-foreground'}>
                    {o.status}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {o.status === 'Pendente' && (
                    <Button variant="outline" size="sm" onClick={() => abrirReparo(o)}>
                      <Wrench className="mr-1 size-4" /> Registrar reparo
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma ocorrência encontrada.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollHorizontalTopo>

      {/* Dialog de reparo */}
      <Dialog open={alvo !== null} onOpenChange={(aberto) => { if (!aberto) setAlvo(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar reparo</DialogTitle>
          </DialogHeader>
          {alvo && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {alvo.sn} · {alvo.pmo}/{alvo.op} · reprovada em <b>{alvo.posto}</b> em {fmtData(alvo.dataHora)}
                {alvo.posicoes.length > 0 && <> · posições: {alvo.posicoes.join(', ')}</>}
                {alvo.cod && <> · defeito relatado: <b>{alvo.cod}</b></>}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="colabRep">Colaborador</Label>
                <Input id="colabRep" value={colaborador} onChange={(e) => setColaborador(e.target.value)} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Consertos</Label>
                {consertos.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_auto] items-center gap-2">
                    <Input value={c.descricao} onChange={(e) => setConsertos(consertos.map((x, idx) => (idx === i ? { ...x, descricao: e.target.value } : x)))} placeholder="Descrição do conserto" />
                    <Input value={c.posicao} onChange={(e) => setConsertos(consertos.map((x, idx) => (idx === i ? { ...x, posicao: e.target.value } : x)))} placeholder="Posição" />
                    <button type="button" aria-label={`Remover conserto ${i + 1}`} onClick={() => setConsertos(consertos.length > 1 ? consertos.filter((_, idx) => idx !== i) : consertos)} disabled={consertos.length <= 1} className="text-muted-foreground hover:text-red-600 disabled:opacity-30">
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setConsertos([...consertos, { descricao: '', posicao: '' }])} className="self-start text-sm font-medium text-enterplak hover:underline">
                  <Plus className="mr-1 inline size-4" /> Adicionar conserto
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Defeitos constatados</Label>
                <datalist id="defeitos-constatados-list">
                  {defeitosCatalogo.map((c) => <option key={c} value={c} />)}
                </datalist>
                {constatados.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <Input
                      list="defeitos-constatados-list"
                      value={c}
                      onChange={(e) => setConstatados(constatados.map((x, idx) => (idx === i ? e.target.value : x)))}
                      placeholder="Código do defeito (do catálogo)"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      aria-label={`Remover defeito constatado ${i + 1}`}
                      onClick={() => setConstatados(constatados.length > 1 ? constatados.filter((_, idx) => idx !== i) : constatados)}
                      disabled={constatados.length <= 1}
                      className="text-muted-foreground hover:text-red-600 disabled:opacity-30"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setConstatados([...constatados, ''])}
                  className="self-start text-sm font-medium text-enterplak hover:underline"
                >
                  <Plus className="mr-1 inline size-4" /> Adicionar defeito constatado
                </button>
              </div>
              <DialogFooter>
                <Button onClick={onSalvar} disabled={!valido || salvando} className="bg-enterplak hover:bg-enterplak-700">
                  {salvando ? 'Salvando…' : 'Concluir reparo'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
