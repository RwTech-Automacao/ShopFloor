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

/** Input mask: auto-inserts colon for duration field (hh:mm). User types only digits.
 * Keeps ONLY digits, caps to 5 (3h + 2m), and returns h:mm format for 3+ digits.
 * E.g. '230' → '2:30', '12:34' → '12:34', '100000' → '100:00' (capped).
 */
export function mascararTempoAuto(bruto: string): string {
  // Keep only digits
  const digits = bruto.replace(/\D/g, '')

  // If no digits, return empty
  if (digits.length === 0) return ''

  // Cap to 5 digits max (3 hours + 2 minutes)
  const capped = digits.slice(0, 5)

  // If 1 or 2 digits, return raw
  if (capped.length <= 2) return capped

  // 3+ digits: split into hours and minutes (last 2 are minutes)
  const hours = capped.slice(0, capped.length - 2)
  const minutes = capped.slice(capped.length - 2)

  return `${hours}:${minutes}`
}
