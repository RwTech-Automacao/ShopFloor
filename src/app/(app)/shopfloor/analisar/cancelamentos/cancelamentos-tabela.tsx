import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CancelamentoRow } from '@/modules/shopfloor/infra/cancelamento-repository'

// Fuso fixo de Brasília (os timestamps vêm em UTC; a tela renderiza no servidor em UTC).
const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
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

export function CancelamentosTabela({ linhas }: { linhas: CancelamentoRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cancelado em</TableHead>
            <TableHead>SN</TableHead>
            <TableHead>PMO·OP</TableHead>
            <TableHead>Posto</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Colaborador</TableHead>
            <TableHead>Cancelado por</TableHead>
            <TableHead>Motivo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                Nenhum cancelamento registrado.
              </TableCell>
            </TableRow>
          )}
          {linhas.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatarDataHora(l.canceladoEm)}</TableCell>
              <TableCell className="font-mono">{l.sn || '—'}</TableCell>
              {/* PMO e OP são obrigatórios no domínio de Ordens, nunca vazios: sem fallback "—" */}
              <TableCell>{`${l.pmo}·${l.op}`}</TableCell>
              <TableCell>{l.posto || '—'}</TableCell>
              <TableCell>
                {l.statusOriginal
                  ? <Badge variant="outline" className={classePorStatus(l.statusOriginal)}>{l.statusOriginal}</Badge>
                  : '—'}
              </TableCell>
              <TableCell>{l.colaboradorOriginal || '—'}</TableCell>
              <TableCell>{l.canceladoPor}</TableCell>
              <TableCell className="max-w-[16rem] truncate" title={l.motivo}>{l.motivo}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
