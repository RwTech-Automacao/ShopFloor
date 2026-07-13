// Status: 'aberto' e 'em_conferencia' são fixos; os terminais são dinâmicos —
// o valor do campo `resultado` (ex.: 'Aprovado', 'Reprovado', ou o que o Admin
// adicionar à lista "Resultado"). Por isso StatusProcesso é `string`.
export type StatusProcesso = string

export const STATUS_ABERTO = 'aberto'
export const STATUS_EM_CONFERENCIA = 'em_conferencia'

/** Um status é terminal (processo concluído) se não é aberto nem em conferência. */
export function ehTerminal(status: StatusProcesso): boolean {
  return status !== STATUS_ABERTO && status !== STATUS_EM_CONFERENCIA
}

/** `aberto` → `em_conferencia` (promoção automática no 1º salvamento). */
export function podePromoverParaConferencia(status: StatusProcesso): boolean {
  return status === STATUS_ABERTO
}

/** Finalizar (concluir) só a partir de `em_conferencia`. */
export function podeFinalizar(status: StatusProcesso): boolean {
  return status === STATUS_EM_CONFERENCIA
}

/** Reabrir só a partir de um status terminal → volta para `em_conferencia`. */
export function podeReabrir(status: StatusProcesso): boolean {
  return ehTerminal(status)
}

/**
 * Lista os campos `obrigatorioFinalizacao` cujo valor está vazio, na ordem em
 * que aparecem. Usado para bloquear a finalização (hoje só `resultado`).
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
