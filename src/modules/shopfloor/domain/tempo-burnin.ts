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
