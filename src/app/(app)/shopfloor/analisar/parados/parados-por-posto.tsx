import { Badge } from '@/components/ui/badge'
import { formatarIdadeParado } from '@/modules/alertas/domain/parados-texto'
import type { PostoDoRelatorio } from '@/modules/alertas/domain/parados-filtros'
import { TabelaSns } from './tabela-sns'

const pecas = (n: number) => `${n} ${n === 1 ? 'peça' : 'peças'}`
/** As OPs no resumo da linha: as 3 com mais peças e "+N OPs". */
const MAX_OPS = 3

/** Um posto por linha, somando todas as OPs; abrir a linha mostra os números de série parados nele. */
export function ParadosPorPosto({ postos, expediente }: { postos: readonly PostoDoRelatorio[]; expediente: boolean }) {
  if (postos.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {postos.map((p) => {
        const resto = p.ops.length - MAX_OPS
        return (
          <details key={p.posto} className="group rounded-lg border border-border bg-card">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>›</span>
              <span className="font-semibold text-tinta">{p.posto}</span>
              <span className="text-sm">{pecas(p.pecas)}</span>
              <span className="text-sm text-muted-foreground">
                mais antiga há {formatarIdadeParado(p.maisAntigaMin, expediente)}
              </span>
              <span className="text-sm">
                {p.ops.slice(0, MAX_OPS).map((o) => `${o.pmo}/${o.op} (${o.pecas})`).join(', ')}
                {resto > 0 ? ` e mais ${resto} ${resto === 1 ? 'OP' : 'OPs'}` : ''}
              </span>
              {p.consertos > 0 && (
                <Badge variant="outline" className="bg-red-50 text-red-800">aguardando conserto: {p.consertos}</Badge>
              )}
            </summary>
            <TabelaSns sns={p.sns} expediente={expediente} coluna="op" />
          </details>
        )
      })}
    </div>
  )
}
