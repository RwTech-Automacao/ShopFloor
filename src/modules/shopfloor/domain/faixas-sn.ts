import { serieDentroDaFaixa, partesSerie, limparSerie } from './serie'

/**
 * Faixas de Nº de Série de uma OP (0181). Uma OP pode ter N faixas; o SN vale se cair em QUALQUER uma.
 * Cada faixa é lida sozinha (prefixo/número/sufixo de `partesSerie`), então faixas com tamanhos
 * diferentes convivem — o caso que motivou: OP 8682_F com 993 etiquetas 0845801001–0845801993 e 7
 * impressas com um dígito a mais, 08458001024–08458001030.
 *
 * `sn_ini`/`sn_fim` da OP continuam existindo e valem a PRIMEIRA faixa. Quem só tem eles (tela antiga,
 * teste, OP sem a lista carregada) continua funcionando: `faixasDe` cai neles quando a lista vem vazia.
 */
export interface FaixaSN {
  sn_ini: string
  sn_fim: string
}

/** O que basta para julgar um SN: a faixa da OP e, quando carregada, a lista de faixas. */
export interface ComFaixas {
  sn_ini: string
  sn_fim: string
  faixas?: FaixaSN[] | null
}

function preenchida(f: FaixaSN): boolean {
  return (f.sn_ini ?? '').trim() !== '' && (f.sn_fim ?? '').trim() !== ''
}

/** As faixas que valem para a OP: a lista (só as preenchidas) ou, sem lista, a faixa da própria OP. */
export function faixasDe(o: ComFaixas): FaixaSN[] {
  const lista = (o.faixas ?? []).filter(preenchida)
  if (lista.length > 0) return lista
  return preenchida(o) ? [{ sn_ini: o.sn_ini, sn_fim: o.sn_fim }] : []
}

/** Linhas de `sf_ordem_faixas` (embutidas no select) → lista ordenada pelo seq. */
export function faixasDoBanco(rows: { seq: number; sn_ini: string; sn_fim: string }[] | null | undefined): FaixaSN[] {
  return [...(rows ?? [])].sort((a, b) => a.seq - b.seq).map((r) => ({ sn_ini: r.sn_ini, sn_fim: r.sn_fim }))
}

/** O SN cai em alguma faixa da OP? OP sem faixa → false. */
export function serieNasFaixas(o: ComFaixas, serie: string): boolean {
  return faixasDe(o).some((f) => serieDentroDaFaixa(f.sn_ini, f.sn_fim, serie))
}

/** Caracteres do SN numa faixa: o maior dos dois limites (sem separadores). */
function tamanhoDaFaixa(f: FaixaSN): number {
  return Math.max(limparSerie(f.sn_ini).length, limparSerie(f.sn_fim).length)
}

/**
 * Conferência completa do bipe contra as faixas, como o Lançamento faz: além de cair numa faixa, o SN
 * não pode ter mais caracteres que ELA. `serieDentroDaFaixa` compara o número (parseInt), então zeros
 * emendados antes do código entrariam como válidos — o tamanho pega essa leitura suja.
 */
export function conferirSerieNasFaixas(
  o: ComFaixas,
  serie: string,
): { ok: true } | { ok: false; motivo: 'sem_faixa' | 'fora' | 'longo' } {
  const faixas = faixasDe(o)
  if (faixas.length === 0) return { ok: false, motivo: 'sem_faixa' }
  const contem = faixas.filter((f) => serieDentroDaFaixa(f.sn_ini, f.sn_fim, serie))
  if (contem.length === 0) return { ok: false, motivo: 'fora' }
  const n = limparSerie(serie).length
  return contem.some((f) => n <= tamanhoDaFaixa(f)) ? { ok: true } : { ok: false, motivo: 'longo' }
}

/**
 * Duas faixas têm algum SN em comum? Mesma regra de `serieDentroDaFaixa`: numéricas (mesmo prefixo e
 * sufixo) comparam o NÚMERO — por isso 001–100 e 0050–0060 sobrepõem —, as lexicais comparam a cadeia.
 * Uma numérica e uma lexical não são comparáveis: não sobrepõem.
 */
export function faixasSobrepoem(a: FaixaSN, b: FaixaSN): boolean {
  const ai = partesSerie(a.sn_ini), af = partesSerie(a.sn_fim)
  const bi = partesSerie(b.sn_ini), bf = partesSerie(b.sn_fim)
  const numA = !Number.isNaN(ai.num) && !Number.isNaN(af.num)
  const numB = !Number.isNaN(bi.num) && !Number.isNaN(bf.num)
  if (numA && numB) {
    const lc = (s: string) => s.toLowerCase()
    if (lc(ai.prefixo) !== lc(bi.prefixo) || lc(ai.sufixo) !== lc(bi.sufixo)) return false
    const aMin = Math.min(ai.num, af.num), aMax = Math.max(ai.num, af.num)
    const bMin = Math.min(bi.num, bf.num), bMax = Math.max(bi.num, bf.num)
    return aMin <= bMax && bMin <= aMax
  }
  if (numA !== numB) return false
  const aLo = ai.limpo < af.limpo ? ai.limpo : af.limpo, aHi = ai.limpo < af.limpo ? af.limpo : ai.limpo
  const bLo = bi.limpo < bf.limpo ? bi.limpo : bf.limpo, bHi = bi.limpo < bf.limpo ? bf.limpo : bi.limpo
  return aLo <= bHi && bLo <= aHi
}

/** Mesma lista, na mesma ordem (espaços nas pontas não contam). */
export function faixasIguais(a: FaixaSN[], b: FaixaSN[]): boolean {
  if (a.length !== b.length) return false
  return a.every((f, i) => f.sn_ini.trim() === b[i]!.sn_ini.trim() && f.sn_fim.trim() === b[i]!.sn_fim.trim())
}

/** Rótulo curto para listas: a primeira faixa e "+N" quando há mais. OP sem faixa → '—'. */
export function rotuloFaixas(o: ComFaixas): string {
  const faixas = faixasDe(o)
  if (faixas.length === 0) return '—'
  const primeira = `${faixas[0]!.sn_ini}–${faixas[0]!.sn_fim}`
  return faixas.length > 1 ? `${primeira} +${faixas.length - 1}` : primeira
}

/**
 * Faixas que o formulário da OP mandou: o campo `faixas` (JSON da lista) quando existe; sem ele, a
 * faixa única dos campos `sn_ini`/`sn_fim` (o formulário de antes). JSON inválido → lista vazia, que a
 * validação recusa. Item fora do formato vira faixa vazia (também recusada), para não sumir calado.
 */
export function lerFaixasDoFormulario(json: string | null, snIni: string, snFim: string): FaixaSN[] {
  if (json === null) return [{ sn_ini: snIni.trim(), sn_fim: snFim.trim() }]
  let bruto: unknown
  try {
    bruto = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(bruto)) return []
  return bruto.map((item) => {
    const f = (item ?? {}) as { sn_ini?: unknown; sn_fim?: unknown }
    return {
      sn_ini: typeof f.sn_ini === 'string' ? f.sn_ini.trim() : '',
      sn_fim: typeof f.sn_fim === 'string' ? f.sn_fim.trim() : '',
    }
  })
}
