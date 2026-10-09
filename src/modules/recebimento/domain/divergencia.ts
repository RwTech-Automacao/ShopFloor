// Estado do selo de divergência de quantidade. Regra pura, compartilhada pela grade de Processos e
// pelo card do Fluxo: as duas telas têm que decidir o mesmo estado pelo mesmo caminho.
import { temDivergencia } from './etapa-processo'

/** 'sem' = não há divergência (nenhum selo) · 'pendente' = ? · 'justificada' = ✅ */
export type EstadoDivergencia = 'sem' | 'pendente' | 'justificada'

/**
 * A divergência vem PRIMEIRO: ela some sozinha quando a quantidade é corrigida, mas o texto da
 * justificativa continua guardado (se a divergência voltar, a justificativa antiga reaparece).
 * Sem divergência não há selo, mesmo havendo justificativa.
 */
export function estadoDaDivergencia(divergencia: unknown, justificativa: unknown): EstadoDivergencia {
  if (!temDivergencia(divergencia)) return 'sem'
  const explicada = typeof justificativa === 'string' && justificativa.trim() !== ''
  return explicada ? 'justificada' : 'pendente'
}

export const LIMITE_JUSTIFICATIVA = 1000

/** Apara e corta por PONTOS DE CÓDIGO (cortar no meio de um emoji deixaria meio caractere). */
export function cortarJustificativa(texto: unknown): string {
  if (typeof texto !== 'string') return ''
  return [...texto.trim()].slice(0, LIMITE_JUSTIFICATIVA).join('')
}
