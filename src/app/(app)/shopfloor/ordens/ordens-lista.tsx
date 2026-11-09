'use client'

import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { OrdemForm, type OrdemView, type PadraoFluxo } from './ordem-form'
import type { PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import { ExcluirOrdemBotao } from './excluir-ordem-botao'
import { FluxoBotao } from './fluxo-botao'

const TODOS = '__todos__'

export function OrdensLista({
  views,
  chavesPostos,
  postosPerfil,
  padroes,
  pmosExistentes,
  clientesExistentes,
  dadosPorPmo,
}: {
  views: OrdemView[]
  chavesPostos: string[]
  postosPerfil: Record<string, PerfilPosto>
  padroes: PadraoFluxo[]
  pmosExistentes: string[]
  clientesExistentes: string[]
  dadosPorPmo: Record<string, { cliente: string; descricao: string }>
}) {
  const [cliente, setCliente] = useState(TODOS)
  const [status, setStatus] = useState(TODOS)
  const [busca, setBusca] = useState('')

  const clientes = useMemo(() => [...new Set(views.map((v) => v.cliente))].sort(), [views])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return views.filter((v) => {
      if (cliente !== TODOS && v.cliente !== cliente) return false
      const finalizada = v.status.toUpperCase() === 'FINALIZADA'
      if (status === 'ATIVA' && finalizada) return false
      if (status === 'FINALIZADA' && !finalizada) return false
      if (q !== '' && !`${v.pmo} ${v.op} ${v.descricao}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [views, cliente, status, busca])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <OrdemForm postos={chavesPostos} postosPerfil={postosPerfil} padroesExistentes={padroes} pmosExistentes={pmosExistentes} clientesExistentes={clientesExistentes} dadosPorPmo={dadosPorPmo} />
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label>Cliente</Label>
          <Select value={cliente} onValueChange={(v) => setCliente(v ?? TODOS)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os clientes</SelectItem>
              {clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v ?? TODOS)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="ATIVA">Ativa</SelectItem>
              <SelectItem value="FINALIZADA">Finalizada</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="buscaOp">Buscar</Label>
          <Input
            id="buscaOp"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="PMO, OP ou descrição…"
            autoComplete="off"
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Mostrando {filtradas.length} de {views.length} OP(s)
      </p>

      <Table containerClassName="max-h-[65vh] overflow-auto rounded-lg border border-border">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>PMO</TableHead>
              <TableHead>OP</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Faixa SN</TableHead>
              <TableHead className="text-center">Postos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.pmo}</TableCell>
                <TableCell>{o.op}</TableCell>
                <TableCell>{o.cliente}</TableCell>
                <TableCell className="max-w-[240px] truncate">{o.descricao || '—'}</TableCell>
                <TableCell>{o.status.toUpperCase() === 'FINALIZADA' ? 'Finalizada' : 'Ativa'}</TableCell>
                <TableCell>{o.sn_ini && o.sn_fim ? `${o.sn_ini}–${o.sn_fim}` : '—'}</TableCell>
                <TableCell className="text-center">{o.postos.length}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <FluxoBotao pmo={o.pmo} op={o.op} postos={o.postos} />
                    <OrdemForm postos={chavesPostos} postosPerfil={postosPerfil} ordem={o} padroesExistentes={padroes} pmosExistentes={pmosExistentes} clientesExistentes={clientesExistentes} dadosPorPmo={dadosPorPmo} />
                    <ExcluirOrdemBotao id={o.id} rotulo={`${o.pmo}/${o.op}`} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {views.length === 0 ? 'Nenhuma OP cadastrada ainda.' : 'Nenhuma OP para os filtros aplicados.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
      </Table>
    </div>
  )
}
