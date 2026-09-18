import { formatarMeta, formatarTaxa } from './taxa'
import { textoJanela, type Janela } from './janela'

/**
 * Fuso FIXO de São Paulo. O servidor da Lightsail roda em UTC; se a hora da mensagem saísse no
 * fuso do processo, o alerta chegaria com 3 horas de diferença do relógio da fábrica.
 */
const FUSO = 'America/Sao_Paulo'

function partes(d: Date, opcoes: Intl.DateTimeFormatOptions): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, ...opcoes }).formatToParts(d)) {
    saida[p.type] = p.value
  }
  return saida
}

/** '17/09 14:05' */
export function formatarDataHoraCurta(d: Date): string {
  const p = partes(d, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}

/** '14:05' */
export function formatarHora(d: Date): string {
  const p = partes(d, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${p.hour}:${p.minute}`
}

/** 'menos de 1 min' | '35 min' | '2 h' | '1 h 20 min' */
export function formatarDuracao(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000))
  if (totalMin < 1) return 'menos de 1 min'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

export interface DadosMensagem {
  posto: string
  regraNome: string
  taxaMinima: number
  aprovados: number
  reprovados: number
  janela: Janela
  em: Date
}

/** Corpo comum do alerta e do lembrete (duas linhas). */
function corpo(d: DadosMensagem): string {
  return (
    `Taxa: ${formatarTaxa(d.aprovados, d.reprovados)}% ${textoJanela(d.janela)} ` +
    `(mínimo ${formatarMeta(d.taxaMinima)}%) · ${d.aprovados} aprovados, ${d.reprovados} reprovados\n` +
    `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  )
}

export function textoAlerta(d: DadosMensagem): string {
  return `🔴 ${d.posto} abaixo da meta\n${corpo(d)}`
}

/** Lembrete = cabeçalho com o tempo desde a abertura + o MESMO corpo do alerta. */
export function textoLembrete(d: DadosMensagem & { abertaEm: Date }): string {
  const min = Math.max(0, Math.floor((d.em.getTime() - d.abertaEm.getTime()) / 60_000))
  return `⏰ Lembrete — continua abaixo há ${min} min\n${textoAlerta(d)}`
}

export function textoResolvido(d: { posto: string; nome: string; em: Date }): string {
  return `✅ ${d.posto}: resolvido por ${d.nome} às ${formatarHora(d.em)}`
}

export function textoNormalizou(d: {
  posto: string
  aprovados: number
  reprovados: number
  abertaEm: Date
  em: Date
}): string {
  const duracao = formatarDuracao(d.em.getTime() - d.abertaEm.getTime())
  return `🟢 ${d.posto} normalizou: ${formatarTaxa(d.aprovados, d.reprovados)}% (ficou ${duracao} abaixo)`
}

export function textoTeste(nome: string): string {
  return `🔔 Teste do ShopFloor — ${nome}, os alertas de taxa de aprovação vão chegar aqui.`
}

export function textoVinculado(nome: string): string {
  return `✅ Conta vinculada ao ShopFloor (${nome})`
}

export const TEXTO_INSTRUCOES_TELEGRAM =
  'Para receber os alertas do ShopFloor, abra "Meu perfil" no sistema, clique em Vincular no ' +
  'Telegram e me envie o código aqui (ex.: ALERTA-7K3M). O código vale 15 minutos.'
