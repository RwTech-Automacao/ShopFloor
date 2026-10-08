import { lerHhMm, partesSp } from './intervalos'

/** Limites da hora do resumo diário que o gestor pode configurar ('HH:MM', hora da fábrica). */
export const HORA_RESUMO_MIN = '06:00'
export const HORA_RESUMO_MAX = '19:00'

const dois = (n: number) => String(n).padStart(2, '0')

/**
 * Chegou a hora configurada e o resumo ainda não foi enviado HOJE (em São Paulo)?
 *
 * O estado é a DATA do último envio ('AAAA-MM-DD'), não um instante: a pergunta é "já mandei hoje?",
 * e uma rodada atrasada não desloca a hora do relatório. "Hoje" e "agora" vêm de `partesSp` (fuso
 * da fábrica); o servidor roda em UTC e nunca se usa getDate()/getHours().
 */
export function horaDeEnviarResumo(horaResumo: string, enviadoEm: string | null, agora: Date): boolean {
  const alvo = lerHhMm(horaResumo)
  if (alvo === null) return false
  if (Number.isNaN(agora.getTime())) return false

  const sp = partesSp(agora)
  const hoje = `${sp.ano}-${dois(sp.mes)}-${dois(sp.dia)}`
  if (enviadoEm === hoje) return false
  return sp.hora * 60 + sp.minuto >= alvo
}
