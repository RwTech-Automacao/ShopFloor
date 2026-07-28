'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { RegistroRow } from '@/modules/shopfloor/infra/registros-repository'

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  // Fuso fixo de Brasília: os timestamps vêm em UTC do banco e estas telas
  // renderizam no servidor (UTC na Vercel). Sem isto, os horários apareceriam
  // 3h à frente em produção.
  timeZone: 'America/Sao_Paulo',
})

function formatarDataHora(valor: string): string {
  return formatadorData.format(new Date(valor))
}

function classePorStatus(status: string): string {
  const s = status.trim().toLowerCase()
  if (s === 'aprovado') return 'bg-green-100 text-green-800'
  if (s === 'reprovado') return 'bg-red-100 text-red-800'
  return ''
}

function rotuloStatus(status: string): string {
  return status.trim() || 'Sem status'
}

function valorOuTraco(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  return String(valor)
}

interface CampoDetalheProps {
  rotulo: string
  valor: string | number | null | undefined
}

function CampoDetalhe({ rotulo, valor }: CampoDetalheProps) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 flex-1">{valorOuTraco(valor)}</dd>
    </div>
  )
}

interface RegistrosTabelaProps {
  linhas: RegistroRow[]
}

export function RegistrosTabela({ linhas }: RegistrosTabelaProps) {
  const [sel, setSel] = useState<RegistroRow | null>(null)

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/Hora</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>PMO·OP</TableHead>
              <TableHead>Posto</TableHead>
              <TableHead>SN</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Colaborador</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </TableCell>
              </TableRow>
            )}
            {linhas.map((l) => (
              <TableRow
                key={l.id}
                className="cursor-pointer"
                onClick={() => setSel(l)}
                tabIndex={0}
                role="button"
                aria-label={`Detalhes do registro ${l.numero_serie}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSel(l)
                  }
                }}
              >
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatarDataHora(l.data_hora)}
                </TableCell>
                <TableCell>{l.cliente || '—'}</TableCell>
                {/* PMO e OP são obrigatórios no domínio de Ordens, nunca vazios: sem fallback "—" */}
                <TableCell>{`${l.pmo}·${l.op}`}</TableCell>
                <TableCell>{l.posto || '—'}</TableCell>
                <TableCell>{l.numero_serie || '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={classePorStatus(l.status)}>
                    {rotuloStatus(l.status)}
                  </Badge>
                </TableCell>
                <TableCell>{l.colaborador || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={sel !== null} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {sel && (
            <>
              <DialogHeader>
                <DialogTitle>Detalhe do registro</DialogTitle>
              </DialogHeader>
              <dl className="space-y-1.5 text-sm">
                <CampoDetalhe rotulo="Data/Hora" valor={formatarDataHora(sel.data_hora)} />
                <CampoDetalhe rotulo="Cliente" valor={sel.cliente} />
                {/* PMO e OP são obrigatórios no domínio de Ordens, nunca vazios: sem fallback "—" */}
                <CampoDetalhe rotulo="PMO·OP" valor={`${sel.pmo}·${sel.op}`} />
                <CampoDetalhe rotulo="Posto" valor={sel.posto} />
                <CampoDetalhe rotulo="SN" valor={sel.numero_serie} />
                <CampoDetalhe rotulo="Status" valor={rotuloStatus(sel.status)} />
                <CampoDetalhe rotulo="Colaborador" valor={sel.colaborador} />
                <CampoDetalhe rotulo="Nº caixa" valor={sel.numero_caixa} />
                <CampoDetalhe rotulo="Qtd/caixa" valor={sel.qtd_por_caixa} />
                <CampoDetalhe rotulo="Código defeito" valor={sel.codigo_defeito} />
                <CampoDetalhe rotulo="Posição" valor={sel.posicao} />
                <CampoDetalhe rotulo="Tipo defeito" valor={sel.tipo_defeito} />
                <CampoDetalhe rotulo="NQA visual" valor={sel.nqa_visual} />
                <CampoDetalhe rotulo="NQA funcional" valor={sel.nqa_funcional} />
              </dl>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
