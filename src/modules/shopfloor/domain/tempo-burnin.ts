/** 'hh:mm' (horas ilimitadas, minutos 00-59) → minutos. '' → 0. Inválido → null. */
export function tempoParaMinutos(texto: string): number | null {
  const t = texto.trim()
  if (t === '') return 0
  const m = t.match(/^(\d+):([0-5]?\d)$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** minutos → 'h:mm' (minutos com zero à esquerda). */
export function minutosParaTempo(min: number): string {
  const h = Math.floor(min / 60)
  const mm = min % 60
  return `${h}:${String(mm).padStart(2, '0')}`
}

/** minutos → texto legível: '1h 35min', '40min', '2h', '0min'. */
export function formatarDuracao(min: number): string {
  const h = Math.floor(min / 60)
  const mm = min % 60
  if (h === 0) return `${mm}min`
  if (mm === 0) return `${h}h`
  return `${h}h ${mm}min`
}

/** Input mask: filters duration field (hh:mm). User types the ':' themselves.
 * Keeps only digits and one colon; caps hours to 3 digits, minutes to 2 digits.
 * E.g. '1234:567' → '123:56', '5445645645' → '544' (no colon).
 */
export function mascararTempoFiltro(bruto: string): string {
  const limpo = bruto.replace(/[^\d:]/g, '')
  const idx = limpo.indexOf(':')
  if (idx === -1) return limpo.replace(/\D/g, '').slice(0, 3)
  const horas = limpo.slice(0, idx).replace(/\D/g, '').slice(0, 3)
  const minutos = limpo.slice(idx + 1).replace(/\D/g, '').slice(0, 2)
  return `${horas}:${minutos}`
}
