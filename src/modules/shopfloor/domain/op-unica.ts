/** Regra: o número da OP é único global (não repete em nenhum PMO). */

export interface OrdemConflito {
  pmo: string
  op: string
}

/** Mensagem de bloqueio quando o número da OP já existe em outro PMO. */
export function mensagemOpDuplicada(conflito: OrdemConflito): string {
  return `Já existe a OP ${conflito.op} no PMO ${conflito.pmo}. O número da OP deve ser único (não pode repetir em outro PMO).`
}
