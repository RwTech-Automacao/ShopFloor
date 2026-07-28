'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { carregarDashboard, type ItemDashboard } from '@/modules/shopfloor/application/dashboard-actions'
import type { OrdemPesquisa } from '@/modules/shopfloor/infra/pesquisa-repository'

export function DashboardForm({ ordens }: { ordens: OrdemPesquisa[] }) {
  const [cliente, setCliente] = useState('')
  const [pmo, setPmo] = useState('')
  const [op, setOp] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [itens, setItens] = useState<ItemDashboard[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [carregando, startTransition] = useTransition()

  const clientes = useMemo(() => [...new Set(ordens.map((o) => o.cliente))], [ordens])
  const pmos = useMemo(() => [...new Set(ordens.filter((o) => o.cliente === cliente).map((o) => o.pmo))], [ordens, cliente])
  const ops = useMemo(() => ordens.filter((o) => o.cliente === cliente && o.pmo === pmo).map((o) => o.op), [ordens, cliente, pmo])

  function atualizar(opSel?: string) {
    const alvo = opSel ?? op
    if (!alvo) return
    startTransition(async () => {
      const r = await carregarDashboard(pmo, alvo, de, ate)
      if (r.ok) {
        setItens(r.itens)
        setTotal(r.total)
      } else {
        setItens(null)
        toast.error(r.erro)
      }
    })
  }

  return (
    <Card>
      <CardHeader><CardTitle>Progresso por posto</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1.5">
            <Label>Cliente</Label>
            <Select value={cliente} onValueChange={(v) => { setCliente(v ?? ''); setPmo(''); setOp(''); setItens(null) }}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>PMO</Label>
            <Select value={pmo} onValueChange={(v) => { setPmo(v ?? ''); setOp(''); setItens(null) }} disabled={cliente === ''}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{pmos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>OP</Label>
            <Select value={op} onValueChange={(v) => { const novo = v ?? ''; setOp(novo); if (novo) atualizar(novo) }} disabled={pmo === ''}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashDe">De</Label>
            <Input id="dashDe" type="date" value={de} onChange={(e) => { setDe(e.target.value); setItens(null) }} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashAte">Até</Label>
            <Input id="dashAte" type="date" value={ate} onChange={(e) => { setAte(e.target.value); setItens(null) }} />
          </div>
        </div>
        <div>
          <Button variant="outline" onClick={() => atualizar()} disabled={op === '' || carregando}>
            {carregando ? 'Carregando…' : 'Atualizar'}
          </Button>
        </div>

        {itens && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {itens.map(({ posto, contagem }) => {
              const pct = total && total > 0 ? Math.min(100, Math.round((contagem / total) * 100)) : null
              return (
                <div key={posto} className="rounded-lg border border-border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-tinta">{posto}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="text-lg font-semibold text-tinta">{contagem}</span>
                      {total ? ` / ${total}` : ''}
                    </p>
                  </div>
                  {pct !== null && (
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-enterplak" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
