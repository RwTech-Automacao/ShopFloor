'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { caixasDaOp } from '@/modules/shopfloor/application/embalagem-actions'
import type { OpComCaixa, CaixaConsulta } from '@/modules/shopfloor/infra/caixa-repository'

export function CaixasForm({ ops }: { ops: OpComCaixa[] }) {
  const [sel, setSel] = useState('')
  const [caixas, setCaixas] = useState<CaixaConsulta[]>([])
  const [buscou, setBuscou] = useState(false)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [carregando, startCarregar] = useTransition()

  function escolher(v: string) {
    setSel(v)
    setAbertos(new Set())
    setBuscou(false)
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    startCarregar(async () => {
      const r = await caixasDaOp(pmo, op)
      if (!r.ok) { toast.error(r.erro); return }
      setCaixas(r.caixas)
      setBuscou(true)
    })
  }
  function toggle(key: string) {
    setAbertos((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  return (
    <Card>
      <CardHeader><CardTitle>Consultar Caixa</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 sm:max-w-md">
          <Label>OP</Label>
          <Select value={sel} onValueChange={(v) => escolher(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="Selecione a OP" /></SelectTrigger>
            <SelectContent>
              {ops.map((o) => (
                <SelectItem key={`${o.pmo}||${o.op}`} value={`${o.pmo}||${o.op}`}>
                  {o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {buscou && !carregando && caixas.length === 0 && (
          <p className="text-sm text-muted-foreground">Esta OP não tem caixas.</p>
        )}

        <div className="flex flex-col gap-2">
          {caixas.map((c) => {
            const key = `${c.posto}-${c.seq}`
            return (
              <div key={key} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="font-medium">{c.codigo}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {c.posto} · {c.qtd} peça(s)
                    <Badge variant="outline" className={c.fechada ? 'border-green-600 text-green-700' : 'border-amber-500 text-amber-700'}>
                      {c.fechada ? 'fechada' : 'aberta'}
                    </Badge>
                  </span>
                </button>
                {abertos.has(key) && (
                  <ul className="flex flex-col gap-0.5 border-t border-border px-3 py-2 text-sm">
                    {c.sns.length === 0 && <li className="text-muted-foreground">sem peças</li>}
                    {c.sns.map((s, i) => <li key={`${s}-${i}`} className="font-mono">{s}</li>)}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
