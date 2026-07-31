'use client'

import { useEffect, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatarDuracao } from '@/modules/shopfloor/domain/burnin'
import type { BurninAberto } from '@/modules/shopfloor/infra/burnin-repository'

export function BurninPainel({ itens }: { itens: BurninAberto[] }) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{itens.length} peça(s) em Burn-in agora</p>
      <Table containerClassName="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>PMO/OP</TableHead>
            <TableHead>Posto</TableHead>
            <TableHead>Nº de Série</TableHead>
            <TableHead>Entrada</TableHead>
            <TableHead className="text-right">Há quanto tempo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((it) => {
            const min = Math.max(0, Math.round((agora - Date.parse(it.entrada)) / 60000))
            return (
              <TableRow key={`${it.pmo}/${it.op}/${it.posto}/${it.numeroSerie}`}>
                <TableCell>{it.cliente}</TableCell>
                <TableCell>{it.pmo}/{it.op}</TableCell>
                <TableCell>{it.posto}</TableCell>
                <TableCell className="font-medium">{it.numeroSerie}</TableCell>
                <TableCell>{new Date(it.entrada).toLocaleString('pt-BR')}</TableCell>
                <TableCell className="text-right tabular-nums">há {formatarDuracao(min)}</TableCell>
              </TableRow>
            )
          })}
          {itens.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma peça em Burn-in no momento.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
