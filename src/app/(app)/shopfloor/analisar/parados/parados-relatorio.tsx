import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatarIdadeParado } from '@/modules/alertas/domain/parados-texto'
import type { OpDoRelatorio } from '@/modules/alertas/domain/parados-relatorio'

const pecas = (n: number) => `${n} ${n === 1 ? 'peça' : 'peças'}`

/** Uma OP por linha (da mais antiga para a mais nova); abrir a linha mostra os números de série parados. */
export function ParadosRelatorio({ ops, expediente }: { ops: readonly OpDoRelatorio[]; expediente: boolean }) {
  if (ops.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {ops.map((o) => {
        const postos = o.itens.filter((i) => i.tipo === 'posto')
        const consertos = o.itens.filter((i) => i.tipo === 'conserto')
        return (
          <details key={`${o.pmo}/${o.op}`} className="group rounded-lg border border-border bg-card">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>›</span>
              <span className="font-semibold text-tinta">{o.pmo}/{o.op}</span>
              <span className="text-sm">{pecas(o.pecas)}</span>
              <span className="text-sm text-muted-foreground">
                mais antiga há {formatarIdadeParado(o.maisAntigaMin, expediente)}
              </span>
              {postos.length > 0 && (
                <span className="text-sm">{postos.map((i) => `${i.codigo} (${i.pecas})`).join(', ')}</span>
              )}
              {consertos.length > 0 && (
                <Badge variant="outline" className="bg-red-50 text-red-800">
                  aguardando conserto: {consertos.map((i) => `${i.codigo} (${i.pecas})`).join(', ')}
                </Badge>
              )}
            </summary>
            <div className="overflow-x-auto border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SN</TableHead>
                    <TableHead>Posto</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Peças</TableHead>
                    <TableHead className="text-right">Parada há</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.sns.map((s, i) => (
                    <TableRow key={`${s.numeroSerie}-${s.posto}-${i}`}>
                      <TableCell className="font-mono">{s.numeroSerie || '—'}</TableCell>
                      <TableCell>{s.posto}</TableCell>
                      <TableCell>
                        {s.reprovada
                          ? <Badge variant="outline" className="bg-red-100 text-red-800">reprovada, aguardando conserto</Badge>
                          : <span className="text-muted-foreground">parada no posto</span>}
                      </TableCell>
                      <TableCell className="text-right">{s.pecas}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{formatarIdadeParado(s.minutos, expediente)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )
      })}
    </div>
  )
}
