import { minutosDeExpediente } from './horas-de-turno'
import type { Intervalo } from './intervalos'

/** 'posto' = peças paradas no posto; 'conserto' = reprovadas ali, esperando conserto/Manutenção. */
export type TipoItemParado = 'posto' | 'conserto'

/**
 * Peças travadas de UMA OP num posto, como `alerta_travados` (0172) as entrega: já cortadas pelo
 * limite (o app calcula o instante de corte, o banco filtra), `em` = a mais antiga do grupo.
 */
export interface GrupoTravado {
  pmo: string
  op: string
  posto: string
  /** O último registro da peça é uma reprova (aguarda conserto/Manutenção). */
  reprovada: boolean
  pecas: number
  em: Date
  /** Alguns números de série, do mais antigo para o mais novo. */
  amostras: string[]
}

export interface ItemParado {
  tipo: TipoItemParado
  /** O nome do posto. */
  codigo: string
  pecas: number
  /** Minutos decorridos da peça mais antiga do grupo (expediente, ou relógio se a regra não tem turno). */
  minutos: number
  amostras: string[]
}

export interface ParadosDaOp {
  pmo: string
  op: string
  /** O posto da OCORRÊNCIA: fixo por regra (índice único regra x posto x PMO/OP), não o da peça mais antiga. */
  posto: string
  maisAntigaMin: number
  /** A conta foi em horas de expediente (a regra tem turno) e não em relógio corrido. */
  expediente: boolean
  itens: ItemParado[]
}

/** A chave da ocorrência por OP. O banco a grava em `alerta_ocorrencias.defeito` (0167). */
export function chaveDaOp(pmo: string, op: string): string {
  return `${pmo}/${op}`
}

/**
 * Os grupos que o banco devolveu, reunidos por OP (um item por posto, e por reprova). A OP com a
 * peça mais antiga vem primeiro; dentro da OP, o item mais antigo primeiro.
 */
export function paradosPorOp(
  grupos: readonly GrupoTravado[],
  turnos: readonly Intervalo[],
  postoDaOcorrencia: string,
  agora: Date,
): ParadosDaOp[] {
  const expediente = turnos.length > 0
  const porOp = new Map<string, ParadosDaOp>()
  for (const g of grupos) {
    const minutos = minutosDeExpediente(g.em, agora, turnos)
    const chave = chaveDaOp(g.pmo, g.op)
    let op = porOp.get(chave)
    if (!op) {
      op = { pmo: g.pmo, op: g.op, posto: postoDaOcorrencia, maisAntigaMin: 0, expediente, itens: [] }
      porOp.set(chave, op)
    }
    op.itens.push({
      tipo: g.reprovada ? 'conserto' : 'posto', codigo: g.posto, pecas: g.pecas, minutos, amostras: g.amostras,
    })
    op.maisAntigaMin = Math.max(op.maisAntigaMin, minutos)
  }
  const lista = [...porOp.values()]
  for (const o of lista) {
    o.itens.sort((a, b) => b.minutos - a.minutos || a.codigo.localeCompare(b.codigo) || a.tipo.localeCompare(b.tipo))
  }
  lista.sort((a, b) => b.maisAntigaMin - a.maisAntigaMin || a.pmo.localeCompare(b.pmo) || a.op.localeCompare(b.op))
  return lista
}

/** A forma que o `alerta_avaliar` lê em `p_parados -> "<regra_id>"`. */
export function paradosParaBanco(ops: readonly ParadosDaOp[]) {
  return ops.map((o) => ({
    pmo: o.pmo,
    op: o.op,
    posto: o.posto,
    mais_antiga_min: o.maisAntigaMin,
    expediente: o.expediente,
    itens: o.itens.map((i) => ({
      tipo: i.tipo, codigo: i.codigo, pecas: i.pecas, minutos: i.minutos, amostras: i.amostras,
    })),
  }))
}
