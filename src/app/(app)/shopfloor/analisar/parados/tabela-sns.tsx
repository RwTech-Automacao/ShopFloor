import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatarIdadeParado } from '@/modules/alertas/domain/parados-texto'
import { tipoDaPeca } from '@/modules/alertas/domain/parados-filtros'
import type { SnParadoComIdade } from '@/modules/alertas/domain/parados-relatorio'

/** Os números de série parados de uma linha (OP ou posto), da mais antiga para a mais nova. */
export function TabelaSns({ sns, expediente, coluna }: {
  sns: readonly SnParadoComIdade[]
  expediente: boolean
  /** A coluna que muda conforme o agrupamento: o posto (por OP) ou a OP (por posto). */
  coluna: 'posto' | 'op'
}) {
  return (
    <div className="overflow-x-auto border-t border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SN</TableHead>
            <TableHead>{coluna === 'posto' ? 'Posto' : 'OP'}</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead className="text-right">Peças</TableHead>
            <TableHead className="text-right">Parada há</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sns.map((s, i) => (
            <TableRow key={`${s.pmo}/${s.op}-${s.numeroSerie}-${s.posto}-${i}`}>
              <TableCell className="font-mono">{s.numeroSerie || '—'}</TableCell>
              <TableCell>{coluna === 'posto' ? s.posto : `${s.pmo}/${s.op}`}</TableCell>
              <TableCell>
                {s.reprovada
                  ? <Badge variant="outline" className="bg-red-100 text-red-800">reprovada, aguardando conserto</Badge>
                  : tipoDaPeca(s) === 'conserto'
                    ? <Badge variant="outline" className="bg-red-50 text-red-800">na Manutenção</Badge>
                    : <span className="text-muted-foreground">parada no posto</span>}
              </TableCell>
              <TableCell className="text-right">{s.pecas}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{formatarIdadeParado(s.minutos, expediente)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
