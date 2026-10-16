import type { LeiturasOp } from './estado-op'

/**
 * Converte as respostas CRUAS do Compels em `LeiturasOp`. As respostas vêm em formatos diferentes
 * conforme o endpoint (lista direta, `{ data: [...] }` ou `{ results: [...] }`), então tudo passa
 * por `listaDe`. Qualquer campo que falte ou não seja número vira `RespostaInesperada`: a
 * integração para com "leitura inconsistente" em vez de assumir zero (zero é justamente o valor
 * enganoso dos contadores das listas).
 */
export class RespostaInesperada extends Error {
  constructor(onde: string) {
    super(`Resposta inesperada do Compels (${onde}).`)
    this.name = 'RespostaInesperada'
  }
}

type Json = unknown

export function objeto(valor: Json, onde: string): Record<string, Json> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new RespostaInesperada(onde)
  return valor as Record<string, Json>
}

export function texto(o: Record<string, Json>, campo: string, onde: string): string {
  const v = o[campo]
  if (typeof v !== 'string') throw new RespostaInesperada(`${onde}.${campo}`)
  return v
}

export function numero(o: Record<string, Json>, campo: string, onde: string): number {
  const v = o[campo]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RespostaInesperada(`${onde}.${campo}`)
  return v
}

/** Aceita lista direta, `{ data: [...] }` ou `{ results: [...] }`. */
export function listaDe(resposta: Json, onde: string): Record<string, Json>[] {
  const bruta = Array.isArray(resposta)
    ? resposta
    : Array.isArray((resposta as { data?: Json } | null)?.data)
      ? (resposta as { data: Json[] }).data
      : Array.isArray((resposta as { results?: Json } | null)?.results)
        ? (resposta as { results: Json[] }).results
        : null
  if (!bruta) throw new RespostaInesperada(onde)
  return bruta.map((linha) => objeto(linha, onde))
}

export interface RespostasCruas {
  /** Linha da OP (de `ordemProducaoSimples/findAllFilter` ou `findById`). */
  op: Json
  empenhos: Json
  requisicoes: Json
  apontamentos: Json
}

export function leiturasDeRespostas(r: RespostasCruas): LeiturasOp {
  const op = objeto((r.op as { data?: Json } | null)?.data ?? r.op, 'op')
  if (typeof op.status !== 'string') throw new RespostaInesperada('op.status')

  return {
    status: op.status,
    tipoPropriedade: numero(op, 'tipoPropriedade', 'op'),
    quantidadeOp: numero(op, 'quantidade', 'op'),
    empenhos: listaDe(r.empenhos, 'empenhos').map((e) => ({
      quantidade: numero(e, 'quantidade', 'empenho'),
      quantidadeEstornar: numero(e, 'quantidadeEstornar', 'empenho'),
      situacao: texto(e, 'situacao', 'empenho'),
    })),
    requisicoes: listaDe(r.requisicoes, 'requisicoes').map((q) => ({
      quantidade: numero(q, 'quantidade', 'requisicao'),
      quantidadeEstornar: numero(q, 'quantidadeEstornar', 'requisicao'),
      situacao: texto(q, 'situacao', 'requisicao'),
    })),
    apontamentos: listaDe(r.apontamentos, 'apontamentos').map((a) => ({
      quantidadeProduzida: numero(a, 'quantidadeProduzida', 'apontamento'),
      quantidadeCancelada: numero(a, 'quantidadeCancelada', 'apontamento'),
      ...(typeof a.dataInicio === 'string' ? { dataInicio: a.dataInicio } : {}),
    })),
  }
}
