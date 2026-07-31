import { serieDentroDaFaixa, limparSerie } from './serie'

/**
 * Resolve a OP de um SN bipado pela faixa de nº de série. Só considera OPs com faixa
 * cadastrada (sn_ini/sn_fim não-vazios). 0 matches → SEM_OP; >1 → AMBIGUO (não deveria
 * ocorrer com SN único); exatamente 1 → ok.
 */
export function resolverOpPorSn<T extends { sn_ini: string; sn_fim: string }>(
  ordens: T[],
  sn: string,
): { ok: true; ordem: T } | { ok: false; erro: 'SEM_OP' | 'AMBIGUO' } {
  const alvo = limparSerie(sn)
  if (alvo === '') return { ok: false, erro: 'SEM_OP' }
  const casam = ordens.filter(
    (o) => o.sn_ini.trim() !== '' && o.sn_fim.trim() !== '' && serieDentroDaFaixa(o.sn_ini, o.sn_fim, alvo),
  )
  if (casam.length === 0) return { ok: false, erro: 'SEM_OP' }
  if (casam.length > 1) return { ok: false, erro: 'AMBIGUO' }
  return { ok: true, ordem: casam[0]! }
}
