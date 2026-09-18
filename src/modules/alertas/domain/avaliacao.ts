import type { Canal } from './tipos'

/** Um destino concreto: a conta vinculada de um destinatário num canal. */
export interface ContaDestino {
  usuarioId: string
  canal: Canal
  externoId: string
}

/**
 * Resumo do `alerta_avaliar()`. As mensagens NÃO vêm aqui: o banco já as pôs na fila
 * (`alerta_envios` pendentes) na mesma transação da decisão; quem entrega é `entregarPendentes`.
 */
export interface ResultadoAvaliacaoRpc {
  ocupado: boolean
  avaliadas: number
  /** Linhas pendentes criadas nesta avaliação. */
  enfileirados: number
  /** Ocorrências encerradas nesta avaliação: as mensagens delas perdem o botão "Resolvido". */
  normalizadas: string[]
}

/**
 * Converte o jsonb do `alerta_avaliar()`. Entrada inesperada vira zero/vazio em vez de exceção:
 * o banco já gravou a decisão, e a rota do cron não pode cair por causa do formato do resumo.
 */
export function lerResultadoAvaliacao(json: unknown): ResultadoAvaliacaoRpc {
  const raiz = (json ?? {}) as Record<string, unknown>
  const normalizadas = Array.isArray(raiz.normalizadas)
    ? raiz.normalizadas.map((id) => String(id ?? '')).filter((id) => id !== '')
    : []
  return {
    ocupado: raiz.ocupado === true,
    avaliadas: Number(raiz.avaliadas ?? 0) || 0,
    enfileirados: Number(raiz.enfileirados ?? 0) || 0,
    normalizadas,
  }
}
