'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarDefeitosDaOp } from '@/modules/shopfloor/application/pesquisa-actions'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'
import type { DefeitoDaOp } from '@/modules/shopfloor/infra/pesquisa-repository'

const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' })
function fmtData(iso: string): string { return iso ? fmt.format(new Date(iso)) : '—' }

export function DefeitosForm({ ops }: { ops: OpItem[] }) {
  const [sel, setSel] = useState('')
  const [filtroOp, setFiltroOp] = useState('')
  const [linhas, setLinhas] = useState<DefeitoDaOp[]>([])
  const [buscou, setBuscou] = useState(false)
  const [temMais, setTemMais] = useState(false)
  const [carregando, startCarregar] = useTransition()
  const [carregandoMais, startMais] = useTransition()

  // Dropdown de OP com filtro por texto (a lista pode ser longa).
  const opsFiltradas = useMemo(() => {
    const f = filtroOp.trim().toLowerCase()
    if (!f) return ops
    return ops.filter((o) => `${o.pmo}/${o.op} ${o.cliente ?? ''}`.toLowerCase().includes(f))
  }, [ops, filtroOp])

  function escolher(v: string) {
    setSel(v); setLinhas([]); setBuscou(false); setTemMais(false)
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    startCarregar(async () => {
      const r = await carregarDefeitosDaOp(pmo, op, 0)
      if (!r.ok) { toast.error(r.erro); return }
      setLinhas(r.linhas); setTemMais(r.temMais); setBuscou(true)
    })
  }

  function carregarMais() {
    if (carregandoMais || !temMais) return
    const [pmo, op] = sel.split('||')
    if (!pmo || !op) return
    startMais(async () => {
      const r = await carregarDefeitosDaOp(pmo, op, linhas.length)
      if (!r.ok) { toast.error(r.erro); return }
      setLinhas((prev) => [...prev, ...r.linhas]); setTemMais(r.temMais)
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Defeitos da OP</CardTitle>
        {buscou && <span className="text-sm text-muted-foreground">{linhas.length}{temMais ? '+' : ''} defeito(s)</span>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 sm:max-w-md">
          <Label>OP</Label>
          <Select value={sel} onValueChange={(v) => escolher(v ?? '')} onOpenChange={(open) => { if (!open) setFiltroOp('') }}>
            <SelectTrigger><SelectValue placeholder="Selecione a OP" /></SelectTrigger>
            <SelectContent className="w-auto min-w-[22rem] max-w-[calc(100vw-2rem)]">
              <div className="sticky top-0 z-10 border-b border-border bg-popover p-1.5" onPointerDown={(e) => e.stopPropagation()}>
                <input
                  value={filtroOp}
                  onChange={(e) => setFiltroOp(e.target.value)}
                  onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}
                  placeholder="Filtrar por PMO / OP / cliente…"
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
              {opsFiltradas.length === 0 ? (
                <p className="px-2 py-2 text-sm text-muted-foreground">Nenhuma OP encontrada.</p>
              ) : (
                opsFiltradas.map((o) => (
                  <SelectItem key={`${o.pmo}||${o.op}`} value={`${o.pmo}||${o.op}`}>
                    {o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {buscou && !carregando && linhas.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum defeito registrado nesta OP.</p>
        )}

        {linhas.length > 0 && (
          <div
            className="max-h-[60vh] overflow-y-auto rounded-lg border border-border"
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) carregarMais()
            }}
          >
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Data/hora</th>
                  <th className="px-3 py-2 text-left font-medium">Defeito</th>
                  <th className="px-3 py-2 text-left font-medium">Posição</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium">Posto</th>
                  <th className="px-3 py-2 text-left font-medium">Nº de Série</th>
                  <th className="px-3 py-2 text-left font-medium">Colaborador</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{fmtData(l.dataHora)}</td>
                    <td className="px-3 py-1.5 font-medium">{l.codigo || '—'}</td>
                    <td className="px-3 py-1.5">{l.posicao || '—'}</td>
                    <td className="px-3 py-1.5">{l.tipo || '—'}</td>
                    <td className="px-3 py-1.5">{l.posto}</td>
                    <td className="px-3 py-1.5 font-mono">{l.sn}</td>
                    <td className="px-3 py-1.5">{l.colaborador || '—'}</td>
                  </tr>
                ))}
                {temMais && (
                  <tr><td colSpan={7} className="px-3 py-2 text-center text-xs text-muted-foreground">
                    {carregandoMais ? 'Carregando…' : 'Role para carregar mais'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
