/**
 * "Lembrar a cada": além dos minutos livres, as duas frequências de sempre viram opção. O que vai ao
 * servidor continua sendo o número de minutos (`lembrete_min`) — a validação não muda.
 */
export const LEMBRETE_DIA_MIN = 1440
export const LEMBRETE_SEMANA_MIN = 10080

export type ModoLembrete = 'nenhum' | 'dia' | 'semana' | 'personalizado'

/** A opção em que o valor salvo abre: vazio = sem lembrete; 1440/10080 = as opções fixas. */
export function modoLembreteInicial(minutos: string): ModoLembrete {
  const t = minutos.trim()
  if (t === '') return 'nenhum'
  if (t === String(LEMBRETE_DIA_MIN)) return 'dia'
  if (t === String(LEMBRETE_SEMANA_MIN)) return 'semana'
  return 'personalizado'
}

/** Os minutos que a opção escolhida grava. O personalizado mantém o que já estava no campo. */
export function minutosDoModoLembrete(modo: ModoLembrete, atual: string): string {
  switch (modo) {
    case 'nenhum':
      return ''
    case 'dia':
      return String(LEMBRETE_DIA_MIN)
    case 'semana':
      return String(LEMBRETE_SEMANA_MIN)
    case 'personalizado':
      return atual
  }
}
