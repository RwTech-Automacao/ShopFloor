'use client'

import { useMemo, useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buscarHistoricoSN, carregarGrade } from '@/modules/shopfloor/application/pesquisa-actions'
import type { RegistroHistorico, OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'
import type { LinhaGrade } from '@/modules/shopfloor/domain/grade'

const TODAS = '__todas__'

function corCelula(v: string): string {
  if (v === 'Aprovado' || v === 'Concluído') return 'text-green-700 font-medium'
  if (v === 'Reprovado') return 'text-red-600 font-medium'
  if (v === 'Pendente' || v === '—') return 'text-muted-foreground'
  return 'text-tinta'
}

export function PesquisaForm({ ordens }: { ordens: OrdemPesquisa[] }) {
  // --- busca por SN ---
  const [sn, setSn] = useState('')
  const [registros, setRegistros] = useState<RegistroHistorico[] | null>(null)
  const [buscando, startBusca] = useTransition()

  // --- grade ---
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [colunas, setColunas] = useState<string[]>([])
  const [linhas, setLinhas] = useState<LinhaGrade[] | null>(null)
  const [caixa, setCaixa] = useState('')
  const [carregando, startGrade] = useTransition()

  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))], [ordens])
  const pmos = useMemo(
    () => [...new Set(ordens.filter((o) => o.cliente === cliente).map((o) => o.pmo))],
    [ordens, cliente],
  )
  const ops = useMemo(
    () => ordens.filter((o) => o.cliente === cliente && o.pmo === pmo).map((o) => o.op),
    [ordens, cliente, pmo],
  )

  const caixas = useMemo(() => {
    if (!linhas) return []
    const set = new Set<string>()
    for (const l of linhas) {
      const v = l.celulas['Embalagem']
      if (v && v !== 'Pendente' && v !== 'Registrado') set.add(v)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  }, [linhas])

  const linhasFiltradas = useMemo(() => {
    if (!linhas) return null
    if (caixa === '') return linhas
    return linhas.filter((l) => l.celulas['Embalagem'] === caixa)
  }, [linhas, caixa])

  function onBuscar() {
    if (sn.trim() === '' || buscando) return
    startBusca(async () => {
      const r = await buscarHistoricoSN(sn)
      if (r.ok) setRegistros(r.registros)
      else toast.error(r.erro)
    })
  }

  function abrirGrade(opSel: string) {
    setOp(opSel)
    setCaixa('')
    startGrade(async () => {
      const r = await carregarGrade(pmo, opSel)
      if (r.ok) {
        setColunas(r.colunas)
        setLinhas(r.linhas)
      } else {
        setLinhas(null)
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
      {/* Busca por SN */}
      <Card>
        <CardHeader><CardTitle>Buscar por Nº de Série</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snBusca">Nº de Série</Label>
              <Input id="snBusca" value={sn} onChange={(e) => setSn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBuscar() } }} autoComplete="off" placeholder="Bipe ou digite o SN" />
            </div>
            <Button variant="outline" onClick={onBuscar} disabled={buscando}>
              <Search className="mr-1 size-4" /> {buscando ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>
          {registros !== null && registros.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum registro para esse SN.</p>
          )}
          {registros !== null && registros.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Posto</TableHead>
                    <TableHead>PMO/OP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Caixa</TableHead>
                    <TableHead>Defeito</TableHead>
                    <TableHead>NQA</TableHead>
                    <TableHead>Integração</TableHead>
                    <TableHead>Reparo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registros.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{fmtData(r.dataHora)}</TableCell>
                      <TableCell>{r.colaborador}</TableCell>
                      <TableCell>{r.posto}</TableCell>
                      <TableCell>{r.pmo}/{r.op}</TableCell>
                      <TableCell className={corCelula(r.status)}>{r.status || '—'}</TableCell>
                      <TableCell>{r.numeroCaixa || '—'}</TableCell>
                      <TableCell>{[r.cod, r.pos, r.tipo].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell>{[r.nqaVisual, r.nqaFuncional].filter(Boolean).join(' / ') || '—'}</TableCell>
                      <TableCell>{r.idIntegracao || '—'}</TableCell>
                      <TableCell>{[r.reparoConserto, r.reparoPosicao].filter(Boolean).join(' · ') || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grade Geral */}
      <Card>
        <CardHeader><CardTitle>Grade Geral</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label>Cliente</Label>
              <Select value={cliente} onValueChange={(v) => { setCliente(v ?? ''); setPmo(''); setOp(''); setLinhas(null) }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>PMO</Label>
              <Select value={pmo} onValueChange={(v) => { setPmo(v ?? ''); setOp(''); setLinhas(null) }} disabled={cliente === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{pmos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>OP</Label>
              <Select value={op} onValueChange={(v) => { if (v) abrirGrade(v) }} disabled={pmo === ''}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Caixa</Label>
              <Select value={caixa === '' ? TODAS : caixa} onValueChange={(v) => setCaixa(v === TODAS ? '' : (v ?? ''))} disabled={caixas.length === 0}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODAS}>Todas</SelectItem>
                  {caixas.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {carregando && <p className="text-sm text-muted-foreground">Carregando grade…</p>}

          {linhasFiltradas && (
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Nº de Série</TableHead>
                    {colunas.map((p) => <TableHead key={p}>{p}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhasFiltradas.map((l) => (
                    <TableRow key={l.sn}>
                      <TableCell className="font-medium">{l.sn}</TableCell>
                      {colunas.map((p) => (
                        <TableCell key={p} className={corCelula(l.celulas[p] ?? '')}>{l.celulas[p] ?? '—'}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
