import { Badge } from '@/components/ui/badge'
import { formatarIdadeParado } from '@/modules/alertas/domain/parados-texto'
import type { OpDoRelatorio } from '@/modules/alertas/domain/parados-relatorio'
import { TabelaSns } from './tabela-sns'

const pecas = (n: number) => `${n} ${n === 1 ? 'peça' : 'peças'}`

/** Uma OP por linha (na ordem escolhida); abrir a linha mostra os números de série parados. */
export function ParadosRelatorio({ ops, expediente }: {
  ops: readonly (OpDoRelatorio & { finalizada?: boolean })[]
  expediente: boolean
}) {
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
              {o.finalizada && <Badge variant="outline">OP finalizada</Badge>}
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
            <TabelaSns sns={o.sns} expediente={expediente} coluna="posto" />
          </details>
        )
      })}
    </div>
  )
}
