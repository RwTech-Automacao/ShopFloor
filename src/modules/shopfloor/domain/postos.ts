/** Ordem lógica do fluxo (do Código.gs POSTO_FLOW_ORDER). Manutenção é fora do fluxo. */
export const ORDEM_FLUXO_POSTOS = [
  'Inicial', 'Inspeção SPI', 'Inspeção SMD', 'Montagem PTH', 'Inspeção PTH', 'Teste',
  'Integração', 'Teste Final', 'Inspeção Final', 'Embalagem', 'Inspeção NQA', 'Manutenção',
] as const

/** Posto anterior aplicável que precisa estar concluído antes do posto atual (ou null). */
export function postoAnteriorExigido(
  postoAtual: string,
  aplicavel: (posto: string) => boolean,
): string | null {
  if (/^manuten[çc][aã]o$/i.test(postoAtual)) return null
  const seq = ORDEM_FLUXO_POSTOS
  const idx = seq.findIndex((p) => p.toLowerCase() === postoAtual.toLowerCase())
  if (idx <= 0) return null
  for (let j = idx - 1; j >= 0; j--) {
    const cand = seq[j]!
    if (cand === 'Manutenção') continue
    if (aplicavel(cand)) return cand
  }
  return null
}

export interface SnapshotPosto {
  registrado?: boolean
  aprovado?: boolean
}

/** O gate do posto anterior está satisfeito? (registrado p/ Inicial/Montagem/Integração/Embalagem; aprovado p/ NQA e demais). */
export function gateSatisfeito(prevPosto: string, postos: Record<string, SnapshotPosto>): boolean {
  const key = prevPosto.toLowerCase()
  const flags = postos[prevPosto] ?? postos[key] ?? {}
  if (['inicial', 'montagem pth', 'integração', 'integracao', 'embalagem'].includes(key)) {
    return flags.registrado === true
  }
  return flags.aprovado === true
}
