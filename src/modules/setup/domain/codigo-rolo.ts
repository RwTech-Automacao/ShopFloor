/** Texto de posição, feeder, posto, locação e componente: maiúsculas, sem espaços nas pontas. */
export function normalizarTexto(t: string): string {
  return (t ?? '').toString().trim().toUpperCase()
}

const SEPARADOR = /[-–—_:/ ]/

/** Código de componente com separador (- – — _ : / ou espaço) nunca casa com o prefixo do rolo (espelha st_rolo_prefixo/0112). */
export function contemSeparador(codigo: string): boolean {
  return SEPARADOR.test(codigo)
}

/**
 * Código do rolo = CÓDIGO_ERP + separador + LOTE_E_NÚMERO_DO_ROLO (ex.: CAPJ41-8521556004).
 * O prefixo é o componente (confere com a estrutura da PMO); o sequencial identifica o rolo
 * (único por rolo). Espelha st_rolo_prefixo/st_rolo_sequencial (0112).
 */
export function separarRolo(codigo: string): { valido: boolean; prefixo: string; sequencial: string; normalizado: string } {
  const normalizado = normalizarTexto(codigo)
  const i = normalizado.search(SEPARADOR)
  if (i <= 0) return { valido: false, prefixo: i === 0 ? '' : normalizado, sequencial: '', normalizado }
  const prefixo = normalizado.slice(0, i)
  const sequencial = normalizado.slice(i + 1).trim()
  return { valido: sequencial !== '', prefixo, sequencial, normalizado }
}
