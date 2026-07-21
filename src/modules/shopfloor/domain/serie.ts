/** Normaliza SN para COMPARAÇÃO/duplicidade (sem separadores, sem zeros à esquerda, minúsculo). */
export function normalizarSerie(sn: string): string {
  return (sn ?? '').toString().replace(/[^A-Za-z0-9]/g, '').replace(/^0+/, '').trim().toLowerCase()
}

/** Limpa SN para SALVAR (sem separadores, MANTÉM zeros à esquerda). */
export function limparSerie(sn: string): string {
  return (sn ?? '').toString().replace(/[^A-Za-z0-9]/g, '').trim()
}

export interface PartesSerie {
  limpo: string
  prefixo: string
  num: number
  sufixo: string
  largura: number
}

/** Interpreta o SN como [letras?][dígitos][letras?] — um único bloco de dígitos. */
export function partesSerie(sn: string): PartesSerie {
  const limpo = (sn ?? '').toString().replace(/[^A-Za-z0-9]/g, '').trim()
  const m = limpo.match(/^([A-Za-z]*)(\d+)([A-Za-z]*)$/)
  if (!m) return { limpo, prefixo: '', num: NaN, sufixo: '', largura: 0 }
  return { limpo, prefixo: m[1]!, num: parseInt(m[2]!, 10), sufixo: m[3]!, largura: m[2]!.length }
}

/**
 * Faixa de SN: numérica quando início/fim/alvo têm bloco de dígitos (com prefixo e sufixo
 * casando), senão comparação lexical. Prefixo/sufixo divergentes → fora da faixa.
 */
export function serieDentroDaFaixa(snIni: string, snFim: string, serie: string): boolean {
  const a = partesSerie(snIni)
  const b = partesSerie(snFim)
  const x = partesSerie(serie)
  if (!Number.isNaN(a.num) && !Number.isNaN(b.num) && !Number.isNaN(x.num)) {
    const lc = (s: string) => s.toLowerCase()
    if (lc(a.prefixo) !== lc(b.prefixo) || lc(a.sufixo) !== lc(b.sufixo)) return false
    if (lc(x.prefixo) !== lc(a.prefixo) || lc(x.sufixo) !== lc(a.sufixo)) return false
    const min = Math.min(a.num, b.num)
    const max = Math.max(a.num, b.num)
    return x.num >= min && x.num <= max
  }
  const s1 = a.limpo, s2 = b.limpo, sx = x.limpo
  const lo = s1 < s2 ? s1 : s2
  const hi = s1 > s2 ? s1 : s2
  return sx >= lo && sx <= hi
}
