import { tempoParaMinutos } from './tempo-burnin'

/** Tempo mínimo de Burn-in por posto: chave do posto → minutos. */
export type TempoBurninPorPosto = Record<string, number>

/** Linhas do banco (sf_ordem_burnin) → mapa posto→minutos. */
export function agruparTempoBurninPorPosto(linhas: { posto: string; tempo_min: number }[]): TempoBurninPorPosto {
  const out: TempoBurninPorPosto = {}
  for (const l of linhas) out[l.posto] = l.tempo_min
  return out
}

/** Mapa → linhas {posto,tempo_min} para inserir no banco. */
export function temposParaLinhas(tempos: TempoBurninPorPosto): { posto: string; tempo_min: number }[] {
  return Object.entries(tempos).map(([posto, tempo_min]) => ({ posto, tempo_min }))
}

/**
 * Lê o tempo por posto vindo do form (JSON objeto posto→"hhh:mm"), mantendo só os postos de
 * Burn-in informados. Campo vazio ou 0:00 → sem mínimo (não entra). Tempo não-parseável →
 * { ok:false, posto } (nomeia o posto ruim). JSON inválido → mapa vazio.
 */
export function parseTempoBurninPorPosto(
  json: string,
  postosBurnin: string[],
): { ok: true; tempos: TempoBurninPorPosto } | { ok: false; posto: string } {
  let bruto: unknown
  try {
    bruto = JSON.parse(json)
  } catch {
    return { ok: true, tempos: {} }
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return { ok: true, tempos: {} }
  const permitido = new Set(postosBurnin)
  const tempos: TempoBurninPorPosto = {}
  for (const [posto, val] of Object.entries(bruto as Record<string, unknown>)) {
    if (!permitido.has(posto)) continue
    const s = String(val ?? '').trim()
    if (s === '') continue
    const min = tempoParaMinutos(s)
    if (min === null) return { ok: false, posto }
    if (min > 0) tempos[posto] = min
  }
  return { ok: true, tempos }
}
