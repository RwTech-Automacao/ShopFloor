'use client'

import { rotuloTrechoDaOp, type TrechoDaOp } from '@/modules/shopfloor/domain/trechos-op'

/** "Trecho: Todos / PRT410 (8500) / …" acima do desenho. Com menos de 2 trechos não há o que escolher. */
export function SeletorTrecho({ trechos, valor, onChange }: {
  trechos: TrechoDaOp[]
  valor: number | null
  onChange: (seq: number | null) => void
}) {
  if (trechos.length < 2) return null
  const botao = (rotulo: string, seq: number | null) => (
    <button key={seq ?? 'todos'} type="button" aria-pressed={valor === seq} onClick={() => onChange(seq)}
      className={`rounded-md border px-2.5 py-1 text-xs ${valor === seq ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-muted'}`}>
      {rotulo}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Trecho:</span>
      {botao('Todos', null)}
      {trechos.map((t) => botao(rotuloTrechoDaOp(t), t.seq))}
    </div>
  )
}
