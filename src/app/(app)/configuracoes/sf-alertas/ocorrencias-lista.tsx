'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatarDataHoraCurta, rotuloDefeito } from '@/modules/alertas/domain/mensagens'
import { NOME_TIPO_REGRA, type EstadoOcorrencia } from '@/modules/alertas/domain/tipos'
import {
  formatarValorOcorrencia,
  type FiltroOcorrencias,
  type OcorrenciaLinha,
} from '@/modules/alertas/domain/ocorrencia'
import { listarOcorrenciasAction, resolverOcorrenciaAction } from '@/modules/alertas/application/alertas-actions'

const TOAST = { position: 'bottom-center' } as const

function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatarDataHoraCurta(d)
}

function Estado({ estado }: { estado: EstadoOcorrencia }) {
  if (estado === 'aberta') return <Badge variant="destructive">Aberta</Badge>
  if (estado === 'resolvida') return <Badge variant="secondary">Resolvida</Badge>
  return <Badge variant="outline">Normalizada</Badge>
}

export function OcorrenciasLista({
  ocorrenciasIniciais,
  filtroInicial,
}: {
  ocorrenciasIniciais: OcorrenciaLinha[]
  filtroInicial: FiltroOcorrencias
}) {
  const [filtro, setFiltro] = useState<FiltroOcorrencias>(filtroInicial)
  const [lista, setLista] = useState<OcorrenciaLinha[]>(ocorrenciasIniciais)
  const [pendente, startTransition] = useTransition()

  function buscar(novo: FiltroOcorrencias) {
    setFiltro(novo)
    startTransition(async () => {
      const r = await listarOcorrenciasAction(novo)
      if (!r.ok) toast.error(r.erro, TOAST)
      else setLista(r.ocorrencias)
    })
  }

  function resolver(o: OcorrenciaLinha) {
    startTransition(async () => {
      const r = await resolverOcorrenciaAction(o.id)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      toast.success(`${o.posto}: marcada como resolvida`, TOAST)
      const atualizada = await listarOcorrenciasAction(filtro)
      if (atualizada.ok) setLista(atualizada.ocorrencias)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="de">De</Label>
          <Input id="de" type="date" value={filtro.de} onChange={(e) => buscar({ ...filtro, de: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ate">Até</Label>
          <Input id="ate" type="date" value={filtro.ate} onChange={(e) => buscar({ ...filtro, ate: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="estado">Estado</Label>
          <select
            id="estado"
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={filtro.estado}
            onChange={(e) => buscar({ ...filtro, estado: e.target.value as FiltroOcorrencias['estado'] })}
          >
            <option value="">Todos</option>
            <option value="aberta">Aberta</option>
            <option value="resolvida">Resolvida</option>
            <option value="normalizada">Normalizada</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Regra</TableHead>
              <TableHead>Posto (OP)</TableHead>
              <TableHead>Defeito</TableHead>
              <TableHead>Ao abrir</TableHead>
              <TableHead>Última</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Aberta em</TableHead>
              <TableHead>Resolvida</TableHead>
              <TableHead>Normalizada</TableHead>
              <TableHead>Envios</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                  Nenhuma ocorrência no período.
                </TableCell>
              </TableRow>
            )}
            {lista.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">
                  {o.regraNome}
                  <span className="block text-xs font-normal text-muted-foreground">{NOME_TIPO_REGRA[o.regraTipo]}</span>
                </TableCell>
                <TableCell>
                  {o.posto}
                  {o.pmo && o.op ? ` (${o.pmo}/${o.op})` : ''}
                </TableCell>
                <TableCell>{o.defeito ? rotuloDefeito(o.defeito) : '—'}</TableCell>
                <TableCell>{formatarValorOcorrencia(o.regraTipo, o.valorAbertura)}</TableCell>
                <TableCell>{formatarValorOcorrencia(o.regraTipo, o.valorUltimo)}</TableCell>
                <TableCell>
                  <Estado estado={o.estado} />
                </TableCell>
                <TableCell>{quando(o.abertaEm)}</TableCell>
                <TableCell>{o.resolvidaEm ? `${o.resolvidaPorNome} · ${quando(o.resolvidaEm)}` : '—'}</TableCell>
                <TableCell>{quando(o.normalizadaEm)}</TableCell>
                <TableCell>
                  {o.enviosOk} ok{o.enviosFalha > 0 ? ` · ${o.enviosFalha} falha` : ''}
                </TableCell>
                <TableCell className="text-right">
                  {o.estado === 'aberta' && (
                    <Button variant="outline" size="sm" disabled={pendente} onClick={() => resolver(o)}>
                      Marcar resolvida
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
