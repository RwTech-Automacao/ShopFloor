export type StatusProcesso = 'aberto' | 'em_conferencia' | 'finalizado' | 'cancelado'

const TRANSICOES: Record<StatusProcesso, StatusProcesso[]> = {
  aberto: ['em_conferencia', 'cancelado'],
  em_conferencia: ['finalizado', 'cancelado'],
  finalizado: ['em_conferencia'],
  cancelado: [],
}

/**
 * Diz se a transição `de` → `para` é permitida no ciclo de vida do processo
 * de recebimento: aberto → em_conferencia → finalizado/cancelado, com
 * possibilidade de reabrir (finalizado → em_conferencia). `cancelado` é
 * terminal e `finalizado` não pode ir direto para `cancelado`.
 */
export function podeTransicionar(de: StatusProcesso, para: StatusProcesso): boolean {
  return TRANSICOES[de].includes(para)
}

/**
 * Lista os campos `obrigatorioFinalizacao` cujo valor está vazio
 * (null/undefined/branco), na ordem em que aparecem em `campos`. Usado para
 * bloquear a finalização do processo enquanto houver pendências.
 */
export function camposFaltantesFinalizacao(
  valores: Record<string, unknown>,
  campos: { campo: string; obrigatorioFinalizacao: boolean }[],
): string[] {
  return campos
    .filter((c) => c.obrigatorioFinalizacao)
    .filter((c) => {
      const v = valores[c.campo]
      return v === null || v === undefined || String(v).trim() === ''
    })
    .map((c) => c.campo)
}
