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
import type { Defeito } from '@/modules/shopfloor/domain/defeito'
import { DefeitoForm, ExcluirDefeitoButton } from './defeitos-form'

function Tipo({ tipo }: { tipo: 1 | 2 }) {
  return tipo === 1 ? (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      Peça
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
      Teste
    </span>
  )
}

export function DefeitosLista({ defeitos }: { defeitos: Defeito[] }) {
  const [busca, setBusca] = useState('')
  const filtro = busca.trim().toLowerCase()
  const lista = filtro ? defeitos.filter((d) => d.codigo.toLowerCase().includes(filtro)) : defeitos
  const vazio = 'Nenhum defeito cadastrado.'
  const semBusca = 'Nenhum defeito encontrado para essa busca.'
  const mensagem = defeitos.length === 0 ? vazio : semBusca

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
            aria-label="Buscar defeito"
          />
        </div>
        <DefeitoForm />
      </div>

      {/* Desktop: tabela */}
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {mensagem}
                </TableCell>
              </TableRow>
            )}
            {lista.map((d) => (
              <TableRow key={d.codigo}>
                <TableCell className="font-medium">{d.codigo}</TableCell>
                <TableCell><Tipo tipo={d.tipo} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <ExcluirDefeitoButton codigo={d.codigo} />
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
        {lista.map((d) => (
          <div key={d.codigo} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-semibold">{d.codigo}</span>
                <Tipo tipo={d.tipo} />
              </div>
              <ExcluirDefeitoButton codigo={d.codigo} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
