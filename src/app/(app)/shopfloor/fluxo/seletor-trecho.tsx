'use client'

import { rotuloTrechoDaOp, type ProgressoTrecho, type TrechoDaOp } from '@/modules/shopfloor/domain/trechos-op'
import { formatarQuantidade } from '@/modules/shopfloor/domain/estoque-compels'

/** "152/500 · fila 152" (fila só quando há peça esperando o Compels; sem quantidade na OP: só as concluídas). */
function numerosDoBotao(p: ProgressoTrecho): string {
  const feito = p.quantidade != null ? `${formatarQuantidade(p.concluidas)}/${formatarQuantidade(p.quantidade)}` : formatarQuantidade(p.concluidas)
  return p.naFila != null && p.naFila > 0 ? `${feito} · fila ${formatarQuantidade(p.naFila)}` : feito
}

/** A linha de números do trecho escolhido, embaixo dos botões. PMO: só concluídas e reprovadas. */
function resumoDoTrecho(p: ProgressoTrecho): string {
  const partes = [`Concluídas ${formatarQuantidade(p.concluidas)}`, `Reprovadas ${formatarQuantidade(p.reprovadas)}`]
  if (p.apontadas != null) partes.push(`Apontadas no Compels ${formatarQuantidade(p.apontadas)}`)
  if (p.naFila != null) partes.push(`Na fila ${formatarQuantidade(p.naFila)}`)
  return partes.join(' · ')
}

/**
 * "Trecho: Todos / PRT410 (8500) · 152/500 · fila 152 / …" acima do desenho, com o resumo do trecho escolhido
 * embaixo. Com menos de 2 trechos não há o que escolher.
 */
export function SeletorTrecho({ trechos, valor, onChange, progresso }: {
  trechos: TrechoDaOp[]
  valor: number | null
  onChange: (seq: number | null) => void
  /** seq → números do trecho. Sem entrada para o trecho: o botão mostra só o código. */
  progresso?: ReadonlyMap<number, ProgressoTrecho>
}) {
  if (trechos.length < 2) return null
  const botao = (rotulo: string, seq: number | null) => (
    <button key={seq ?? 'todos'} type="button" aria-pressed={valor === seq} onClick={() => onChange(seq)}
      className={`rounded-md border px-2.5 py-1 text-xs ${valor === seq ? 'border-enterplak bg-enterplak text-white' : 'border-border bg-card hover:bg-muted'}`}>
      {rotulo}
    </button>
  )
  const escolhido = valor !== null ? progresso?.get(valor) : undefined
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Trecho:</span>
        {botao('Todos', null)}
        {trechos.map((t) => {
          const p = progresso?.get(t.seq)
          return botao(p ? `${rotuloTrechoDaOp(t)} · ${numerosDoBotao(p)}` : rotuloTrechoDaOp(t), t.seq)
        })}
      </div>
      {escolhido && (
        <p data-testid="resumo-trecho" className="text-xs tabular-nums text-muted-foreground">{resumoDoTrecho(escolhido)}</p>
      )}
    </div>
  )
}
