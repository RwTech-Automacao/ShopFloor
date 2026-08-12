'use client'

import { useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { buscarLogsRepinmetro } from '@/modules/shopfloor/application/repinmetro-actions'
import type { LogRepinmetro } from '@/modules/shopfloor/infra/repinmetro-repository'
import { ITENS_REPINMETRO, classeResultado } from '@/modules/shopfloor/domain/repinmetro'

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
}

const CLASSE_COR: Record<string, string> = {
  aprovado: 'text-green-700',
  reprovado: 'text-red-600 font-medium',
  na: 'text-muted-foreground',
}

/** Um teste do repinmetro: cabeçalho + os 15 itens coloridos. */
function LogCard({ log }: { log: LogRepinmetro }) {
  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">{fmtData(log.dataInicio)}</span>
        {log.modelo && <span className="text-muted-foreground">Modelo {log.modelo}</span>}
        {log.status && (
          <span className={cn('font-medium', CLASSE_COR[classeResultado(log.status)])}>{log.status}</span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 px-3 py-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {ITENS_REPINMETRO.map((item) => {
          const v = log.resultados[item.chave] ?? null
          return (
            <div key={item.chave} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{item.rotulo}</dt>
              <dd className={cn('font-mono text-xs', CLASSE_COR[classeResultado(v)])}>{v || '—'}</dd>
            </div>
          )
        })}
      </dl>
      {(log.observacao || log.lacre) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {log.lacre && <span>Lacre: {log.lacre}</span>}
          {log.observacao && <span>Obs.: {log.observacao}</span>}
        </div>
      )}
    </div>
  )
}

export function RepinmetroForm() {
  const [sn, setSn] = useState('')
  const [logs, setLogs] = useState<LogRepinmetro[] | null>(null)
  const [buscando, startBusca] = useTransition()

  function onBuscar() {
    if (sn.trim() === '' || buscando) return
    startBusca(async () => {
      const r = await buscarLogsRepinmetro(sn)
      if (r.ok) setLogs(r.logs)
      else toast.error(r.erro)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Buscar por Nº de Série</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snRepinmetro">Nº de Série do produto final</Label>
            <Input
              id="snRepinmetro"
              value={sn}
              onChange={(e) => setSn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onBuscar()
                }
              }}
              autoComplete="off"
              placeholder="Bipe ou digite o SN"
            />
          </div>
          <Button variant="outline" onClick={onBuscar} disabled={buscando}>
            <Search className="mr-1 size-4" /> {buscando ? 'Buscando…' : 'Buscar'}
          </Button>
        </div>

        {logs !== null && logs.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum teste do repinmetro para esse Nº de Série.</p>
        )}
        {logs !== null && logs.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {logs.length} teste(s){logs[0]?.numeroSerie ? ` · SN ${logs[0].numeroSerie}` : ''}
            </p>
            {logs.map((log) => (
              <LogCard key={log.origemId} log={log} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
