import { capitalizarDescricaoDefeito, separarCodigoDefeito } from '@/modules/shopfloor/domain/defeito'
import { formatarMeta, formatarTaxa } from './taxa'
import { textoJanela, type Janela } from './janela'
import { formatarMmSs } from './tempo'

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

// ---------------------------------------------------------------------------
// Tipos novos (spec 2026-09-18): tempo médio por peça e defeito repetido
// ---------------------------------------------------------------------------

/**
 * '2040 COMPONENTE FALTANDO' → '2040 (Componente Faltando)'. Em `sf_defeitos` o código JÁ É
 * "número + descrição" (o mesmo texto de `sf_registros.codigo_defeito`), então a descrição do
 * catálogo sai daqui, sem consulta. Sem número → só a descrição; sem descrição → só o número.
 */
export function rotuloDefeito(codigo: string): string {
  const { numero, descricao } = separarCodigoDefeito(codigo)
  const desc = descricao ? capitalizarDescricaoDefeito(descricao) : ''
  if (numero && desc) return `${numero} (${desc})`
  return numero || desc || codigo.trim()
}

export interface DadosMensagemTempo {
  posto: string
  regraNome: string
  mediaSeg: number
  limiteSeg: number
  pecas: number
  janela: Janela
  em: Date
}

export function textoAlertaTempo(d: DadosMensagemTempo): string {
  return (
    `🔴 ${d.posto} lento: ${formatarMmSs(d.mediaSeg)} por peça ${textoJanela(d.janela)} ` +
    `(limite ${formatarMmSs(d.limiteSeg)}) · ${d.pecas} peças\n` +
    `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  )
}

export function textoNormalizouTempo(d: { posto: string; mediaSeg: number }): string {
  return `🟢 ${d.posto} normalizou: ${formatarMmSs(d.mediaSeg)} por peça`
}

export interface DadosMensagemDefeito {
  posto: string
  regraNome: string
  defeito: string
  ocorrencias: number
  limite: number
  janela: Janela
  em: Date
}

export function textoAlertaDefeito(d: DadosMensagemDefeito): string {
  return (
    `🔴 Defeito ${rotuloDefeito(d.defeito)} repetido no ${d.posto}: ${d.ocorrencias} vezes ` +
    `${textoJanela(d.janela)} (limite ${d.limite})\n` +
    `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  )
}

export function textoNormalizouDefeito(d: { posto: string; defeito: string }): string {
  return `🟢 Defeito ${rotuloDefeito(d.defeito)} normalizou no ${d.posto}`
}

/** Lembrete de tempo/defeito: o cabeçalho não fala em "abaixo" (um posto lento está ACIMA do limite). */
export function textoLembreteTipo(alerta: string, abertaEm: Date, em: Date): string {
  const min = Math.max(0, Math.floor((em.getTime() - abertaEm.getTime()) / 60_000))
  return `⏰ Lembrete — continua há ${min} min\n${alerta}`
}
