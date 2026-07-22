/** Posto imediatamente anterior a `postoAtual` na sequência ordenada da OP (ou null). */
export function postoAnteriorNaSequencia(postoAtual: string, postosOrdenados: string[]): string | null {
  const idx = postosOrdenados.findIndex((p) => p.toLowerCase() === postoAtual.toLowerCase())
  if (idx <= 0) return null
  return postosOrdenados[idx - 1] ?? null
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
