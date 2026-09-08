import type { AmostraNqa, CaixaNqa } from '@/modules/shopfloor/application/nqa-caixa-actions'

/**
 * Progresso de uma inspeção NQA por caixa em andamento, persistido em localStorage
 * para sobreviver a refresh / fechar aba / queda de conexão NO MESMO NAVEGADOR.
 * As amostras só vão ao banco quando a caixa é aprovada/reprovada; sem isto, atualizar
 * a página perde tudo que já foi bipado. Guarda também o contexto (colaborador/OP/posto)
 * porque o cabeçalho do Lançamento também é só estado em memória e zera no refresh.
 */
export interface NqaProgresso {
  colaborador: string
  cliente: string
  pmo: string
  op: string
  posto: string
  caixa: CaixaNqa
  amostras: AmostraNqa[]
  selecionados: string[]
  salvoEm: number
}

const CHAVE = 'sf:nqa-progresso'

/** Grava o progresso. Silencioso se o localStorage falhar (indisponível/cheio). */
export function salvarNqaProgresso(p: NqaProgresso): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(p))
  } catch {
    // localStorage indisponível/cheio — segue sem persistir (comportamento de antes).
  }
}

/** Lê o progresso salvo, ou null se não houver / estiver corrompido / localStorage falhar. */
export function lerNqaProgresso(): NqaProgresso | null {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (!bruto) return null
    const p = JSON.parse(bruto) as NqaProgresso
    // Sanidade mínima: precisa de caixa e da lista de amostras.
    if (!p || typeof p !== 'object' || !p.caixa || !Array.isArray(p.amostras)) return null
    return p
  } catch {
    return null
  }
}

/** Apaga o progresso salvo (ao finalizar a caixa, trocar de caixa ou descartar). */
export function limparNqaProgresso(): void {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    // ignore
  }
}
