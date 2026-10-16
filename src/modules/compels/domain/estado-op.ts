/**
 * Estado de uma OP no Compels, calculado a partir das três LISTAS da OP (empenhos, requisições e
 * apontamentos). Nunca dos contadores embutidos: as listas e a OP embutida vêm com os contadores
 * ZERADOS mesmo quando tudo foi feito (OP 8669: 149 apontados, contador 0). O campo `quantidade`
 * de cada linha da lista, ao contrário, vem certo (OP 8697: empenhos 4+1+5, requisições 4+1+5,
 * apontamentos 4+1+3+2). Ver a spec de 16/10/2026, seção 2.4.
 */

export interface LinhaEmpenho {
  quantidade: number
  quantidadeEstornar: number
}

export interface LinhaRequisicao {
  quantidade: number
  quantidadeEstornar: number
}

export interface LinhaApontamento {
  quantidadeProduzida: number
  quantidadeCancelada: number
}

export interface LeiturasOp {
  status: string
  /** `tipoPropriedade` da OP: 0 = estoque próprio. Outro valor (ex.: estoque em terceiros) a integração não trata. */
  tipoPropriedade: number
  /** Quantidade total da OP (`quantidade` da linha da OP). */
  quantidadeOp: number
  empenhos: readonly LinhaEmpenho[]
  requisicoes: readonly LinhaRequisicao[]
  apontamentos: readonly LinhaApontamento[]
}

export interface EstadoOpErp {
  status: string
  tipoPropriedade: number
  quantidadeOp: number
  empenhada: number
  requisitada: number
  apontada: number
  /** Há estorno ou cancelamento na OP: ainda não sabemos como o ERP o representa nas listas. */
  temEstorno: boolean
}

const ESCALA = 1_000_000

/** Quantidades do ERP têm até 6 casas: compara em inteiros para não tropeçar em ponto flutuante. */
export function q6(valor: number): number {
  return Math.round(valor * ESCALA) / ESCALA
}

function soma(valores: readonly number[]): number {
  return q6(valores.reduce((total, v) => total + v, 0))
}

export function estadoDaOp(leituras: LeiturasOp): EstadoOpErp {
  const temEstorno =
    leituras.empenhos.some((e) => q6(e.quantidadeEstornar) !== 0) ||
    leituras.requisicoes.some((r) => q6(r.quantidadeEstornar) !== 0) ||
    leituras.apontamentos.some((a) => q6(a.quantidadeCancelada) !== 0)

  return {
    status: leituras.status,
    tipoPropriedade: leituras.tipoPropriedade,
    quantidadeOp: q6(leituras.quantidadeOp),
    empenhada: soma(leituras.empenhos.map((e) => e.quantidade)),
    requisitada: soma(leituras.requisicoes.map((r) => r.quantidade)),
    apontada: soma(leituras.apontamentos.map((a) => a.quantidadeProduzida)),
    temEstorno,
  }
}
