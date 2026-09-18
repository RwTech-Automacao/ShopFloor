export interface ResolucaoOcorrencia {
  ocorrenciaId: string
  regraId: string
  posto: string
  /** true = alguém já tinha resolvido antes (o botão foi apertado duas vezes). */
  jaResolvida: boolean
  resolvidaPorId: string
  resolvidaPorNome: string
  resolvidaEm: Date
}

export function lerResolucao(json: unknown): ResolucaoOcorrencia {
  const r = (json ?? {}) as Record<string, unknown>
  const em = r.resolvida_em === null || r.resolvida_em === undefined ? null : new Date(String(r.resolvida_em))
  return {
    ocorrenciaId: String(r.ocorrencia_id ?? ''),
    regraId: String(r.regra_id ?? ''),
    posto: String(r.posto ?? ''),
    jaResolvida: r.ja_resolvida === true,
    resolvidaPorId: r.resolvida_por === null || r.resolvida_por === undefined ? '' : String(r.resolvida_por),
    resolvidaPorNome: String(r.resolvida_por_nome ?? ''),
    // Sem data (caso degenerado) o texto ainda precisa de uma hora válida pra mostrar.
    resolvidaEm: em && !Number.isNaN(em.getTime()) ? em : new Date(),
  }
}
