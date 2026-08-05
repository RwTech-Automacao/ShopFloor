'use client'

import { useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Conserto } from '@/modules/shopfloor/domain/conserto'
import { ConsertoForm, ExcluirConservoButton } from './consertos-form'

export function ConsertosLista({ consertos }: { consertos: Conserto[] }) {
  const [busca, setBusca] = useState('')
  const filtro = busca.trim().toLowerCase()
  const lista = filtro ? consertos.filter((c) => c.codigo.toLowerCase().includes(filtro)) : consertos
  const vazio = 'Nenhum conserto cadastrado.'
  const semBusca = 'Nenhum conserto encontrado para essa busca.'
  const mensagem = consertos.length === 0 ? vazio : semBusca

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código…"
            className="pl-9"
            aria-label="Buscar conserto"
          />
        </div>
        <ConsertoForm />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                  {mensagem}
                </TableCell>
              </TableRow>
            )}
            {lista.map((c) => (
              <TableRow key={c.codigo}>
                <TableCell className="font-medium">{c.codigo}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <ExcluirConservoButton codigo={c.codigo} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {lista.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            {mensagem}
          </p>
        )}
        {lista.map((c) => (
          <div key={c.codigo} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{c.codigo}</span>
              <ExcluirConservoButton codigo={c.codigo} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
