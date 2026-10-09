import { instanteSp, lerHhMm, partesSp, type Intervalo } from './intervalos'

/** Limites da hora do resumo diário que o gestor pode configurar ('HH:MM', hora da fábrica). */
export const HORA_RESUMO_MIN = '06:00'
export const HORA_RESUMO_MAX = '19:00'

/** Hora do resumo que uma regra nova já traz (dentro de HORA_RESUMO_MIN–HORA_RESUMO_MAX). */
export const HORA_RESUMO_PADRAO = '18:00'

const dois = (n: number) => String(n).padStart(2, '0')

/** O dia de São Paulo ('AAAA-MM-DD') daquele instante — nunca o dia do processo (que roda em UTC). */
export function diaSp(agora: Date): string {
  const sp = partesSp(agora)
  return `${sp.ano}-${dois(sp.mes)}-${dois(sp.dia)}`
}

/** O que o app manda ao banco para UMA regra de resumo: o dia e as faixas já em instantes reais. */
export interface ResumoDaRodada {
  dia: string
  faixas: { inicio: string; fim: string }[]
}

/**
 * O pacote do `p_resumos` para uma regra: o dia de São Paulo e cada intervalo do turno posto nesse
 * dia como instante (ISO, UTC). O banco só compara `data_hora >= inicio and data_hora < fim` e
 * grava o `dia`; nenhuma conta de fuso mora lá. Intervalo ilegível é pulado; sem nenhum legível
 * devolve null (o chamador loga e pula a regra).
 */
export function resumoDaRodada(intervalos: Intervalo[], agora: Date): ResumoDaRodada | null {
  if (Number.isNaN(agora.getTime())) return null
  const sp = partesSp(agora)
  const faixas: { inicio: string; fim: string }[] = []
  for (const i of intervalos) {
    const ini = lerHhMm(i.inicio)
    const fim = lerHhMm(i.fim)
    if (ini === null || fim === null || fim <= ini) continue
    faixas.push({
      inicio: instanteSp(sp.ano, sp.mes, sp.dia, ini).toISOString(),
      fim: instanteSp(sp.ano, sp.mes, sp.dia, fim).toISOString(),
    })
  }
  return faixas.length === 0 ? null : { dia: diaSp(agora), faixas }
}

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
  if (enviadoEm === diaSp(agora)) return false
  return sp.hora * 60 + sp.minuto >= alvo
}
