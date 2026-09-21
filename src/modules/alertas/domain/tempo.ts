/** Teto do "tempo máximo por peça" (60:00), igual ao check da 0115. */
export const LIMITE_TEMPO_MAX_SEG = 3600

/**
 * Segundos em 'm:ss' (120 → '2:00', 120,5 → '2:01'). A fração de segundo é ARREDONDADA PRA CIMA:
 * aqui, diferente da taxa, número maior é PIOR — truncar mostraria o posto mais rápido do que ele
 * foi (120,5 s viraria "2:00", igual ao limite, escondendo que a regra (média > limite) disparou).
 * O limite configurado já chega inteiro; arredondar um inteiro pra cima não muda nada.
 */
export function formatarMmSs(segundos: number): string {
  const total = Number.isFinite(segundos) && segundos > 0 ? Math.ceil(segundos) : 0
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const RE_MMSS = /^(\d{1,2}):([0-5]\d)$/
const RE_MINUTOS = /^\d{1,2}$/

/**
 * Lê o que o gestor digitou: 'm:ss' ('2:00', '0:45') ou só minutos ('3' = 3:00). Devolve segundos,
 * ou null fora do formato ou fora de 0:01–60:00.
 */
export function lerMmSs(texto: string | null | undefined): number | null {
  const t = String(texto ?? '').trim()
  let segundos: number
  const m = RE_MMSS.exec(t)
  if (m) segundos = Number(m[1]) * 60 + Number(m[2])
  else if (RE_MINUTOS.test(t)) segundos = Number(t) * 60
  else return null
  return segundos >= 1 && segundos <= LIMITE_TEMPO_MAX_SEG ? segundos : null
}
