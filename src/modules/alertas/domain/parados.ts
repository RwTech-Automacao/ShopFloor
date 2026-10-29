import { minutosDeExpediente } from './horas-de-turno'
import type { Intervalo } from './intervalos'

export type TipoItemParado = 'caixa' | 'lote' | 'peca'

/** Uma pendência do Almoxarifado, como a função base a entrega (já com `em` = o momento mais antigo). */
export interface ItemPendente {
  pmo: string
  op: string
  posto: string
  tipo: TipoItemParado
  codigo: string
  pecas: number
  em: Date
}

export interface ItemParado {
  tipo: TipoItemParado
  codigo: string
  pecas: number
  /** Minutos de expediente decorridos desde que ficou pronto. */
  minutos: number
}

export interface ParadosDaOp {
  pmo: string
  op: string
  posto: string
  maisAntigaMin: number
  itens: ItemParado[]
}

/** A chave da ocorrência por OP. O banco a grava em `alerta_ocorrencias.defeito` (0167). */
export function chaveDaOp(pmo: string, op: string): string {
  return `${pmo}/${op}`
}

/**
 * Os itens que passaram do limite (em horas de EXPEDIENTE), agrupados por OP. A OP com o item mais
 * antigo vem primeiro; dentro da OP, o mais antigo primeiro. Nenhum item acima do limite = [].
 */
export function paradosPorOp(
  pendentes: readonly ItemPendente[],
  turnos: readonly Intervalo[],
  limiteHoras: number,
  agora: Date,
): ParadosDaOp[] {
  const limiteMin = limiteHoras * 60
  const grupos = new Map<string, ParadosDaOp>()
  for (const p of pendentes) {
    const minutos = minutosDeExpediente(p.em, agora, turnos)
    if (minutos < limiteMin) continue
    const chave = chaveDaOp(p.pmo, p.op)
    let g = grupos.get(chave)
    if (!g) {
      g = { pmo: p.pmo, op: p.op, posto: p.posto, maisAntigaMin: 0, itens: [] }
      grupos.set(chave, g)
    }
    g.itens.push({ tipo: p.tipo, codigo: p.codigo, pecas: p.pecas, minutos })
    g.maisAntigaMin = Math.max(g.maisAntigaMin, minutos)
  }
  const lista = [...grupos.values()]
  for (const g of lista) g.itens.sort((a, b) => b.minutos - a.minutos || a.codigo.localeCompare(b.codigo))
  lista.sort(
    (a, b) => b.maisAntigaMin - a.maisAntigaMin || a.pmo.localeCompare(b.pmo) || a.op.localeCompare(b.op),
  )
  return lista
}

/** A forma que o `alerta_avaliar` lê em `p_parados -> "<regra_id>"`. */
export function paradosParaBanco(grupos: readonly ParadosDaOp[]) {
  return grupos.map((g) => ({
    pmo: g.pmo,
    op: g.op,
    posto: g.posto,
    mais_antiga_min: g.maisAntigaMin,
    itens: g.itens.map((i) => ({ tipo: i.tipo, codigo: i.codigo, pecas: i.pecas, minutos: i.minutos })),
  }))
}
