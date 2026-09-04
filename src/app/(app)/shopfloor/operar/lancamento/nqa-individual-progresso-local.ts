import type { AmostraNqa } from '@/modules/shopfloor/application/nqa-caixa-actions'
import type { LoteNqaIndividual } from '@/modules/shopfloor/application/nqa-individual-actions'

/**
 * Progresso de uma inspeção NQA individual em andamento, persistido em localStorage para
 * sobreviver a refresh / fechar aba / queda de conexão NO MESMO NAVEGADOR. Cobre as DUAS fases:
 * montando o lote (bipando SN a SN, `lote` ainda null) e inspecionando a amostra (`lote` fechado).
 * Sem isto, atualizar a página no meio de montar um lote de 80 peças perde tudo.
 */
export interface NqaIndividualProgresso {
  colaborador: string
  cliente: string
  pmo: string
  op: string
  posto: string
  snsLote: string[] // fase de montagem — SNs bipados, lote ainda não fechado
  lote: LoteNqaIndividual | null // fase de inspeção — lote fechado (qtd/amostra/snsNorm)
  amostras: AmostraNqa[]
  selecionados: string[]
  salvoEm: number
}

const CHAVE = 'sf:nqa-individual-progresso'

/** Grava o progresso. Silencioso se o localStorage falhar (indisponível/cheio). */
export function salvarNqaIndividualProgresso(p: NqaIndividualProgresso): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(p))
  } catch {
    // localStorage indisponível/cheio — segue sem persistir (comportamento de antes).
  }
}

/** Lê o progresso salvo, ou null se não houver / estiver corrompido / localStorage falhar. */
export function lerNqaIndividualProgresso(): NqaIndividualProgresso | null {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return null
    const p = JSON.parse(bruto) as NqaIndividualProgresso
    if (!p || typeof p !== 'object' || !Array.isArray(p.snsLote) || !Array.isArray(p.amostras)) return null
    return p
  } catch {
    return null
  }
}

/** Apaga o progresso salvo (ao finalizar o lote, descartar ou trocar de contexto). */
export function limparNqaIndividualProgresso(): void {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    // ignore
  }
}
