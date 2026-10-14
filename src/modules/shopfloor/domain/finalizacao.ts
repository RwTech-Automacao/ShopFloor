import { ehOpFinalizada } from './ops-ativas'

/**
 * Quem encerrou a OP (coluna `sf_ordens.finalizada_por`, migração 0145).
 * 'rotina' = a regra dos 100% fechou (a rotina pode reabrir); 'manual' = uma pessoa fechou pela
 * tela (a rotina nunca mexe). O banco guarda também NULO = "não dá para saber"; nunca é gravado
 * por código novo, só herdado.
 */
export type FinalizadaPor = 'rotina' | 'manual'

/**
 * O que a tela de Cadastro de OP grava em `finalizada_por` ao salvar.
 * FINALIZADA pela tela é decisão de pessoa -> 'manual'. Qualquer outro status limpa a marca:
 * reabrir à mão não deixa um 'manual' pendurado numa OP ativa.
 */
export function finalizadaPorDoCadastro(status: string): 'manual' | null {
  return ehOpFinalizada(status) ? 'manual' : null
}

/**
 * A tela de Cadastro de OP acabou de REATIVAR esta OP? (FINALIZADA -> qualquer outro status.)
 *
 * É o que liga `sf_ordens.reaberta_manual` (migração 0148), e a partir daí a rotina dos 100% nunca
 * mais fecha a OP sozinha: senão o gestor reativa a OP para a peça atrasada entrar e a rotina a
 * fecha de novo em até 5 minutos, às vezes antes de o operador bipar.
 *
 * Compara o status ANTERIOR (lido do banco, não do formulário) com o novo. Só a transição conta:
 * marcar em toda edição de OP ativa tiraria a base inteira do controle automático. Status anterior
 * desconhecido (nulo) -> não é reativação; na dúvida, a OP continua automática.
 */
export function ehReativacaoManual(statusAnterior: string | null | undefined, statusNovo: string): boolean {
  return ehOpFinalizada(statusAnterior) && !ehOpFinalizada(statusNovo)
}

/** Contagem devolvida por `sf_sincronizar_finalizacao()`. */
export interface ResumoFinalizacao {
  finalizadas: number
  reabertas: number
}

function inteiroNaoNegativo(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

/** Valida o jsonb da função. Formato inesperado lança (o invólucro da rotina contém o erro). */
export function lerResumoFinalizacao(bruto: unknown): ResumoFinalizacao {
  if (typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto)) {
    const { finalizadas, reabertas } = bruto as Record<string, unknown>
    if (inteiroNaoNegativo(finalizadas) && inteiroNaoNegativo(reabertas)) return { finalizadas, reabertas }
  }
  throw new Error('sf_sincronizar_finalizacao: resposta inesperada do banco')
}
