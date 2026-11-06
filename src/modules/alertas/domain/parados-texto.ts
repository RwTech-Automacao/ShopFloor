import { LIMITE_MENSAGEM, formatarDataHoraCurta, listaComCorte, textoOp, type ParOp } from './mensagens'
import type { ItemParado } from './parados'

/** Margem que o lembrete e a reabertura acrescentam acima do texto (mesma de `mensagens.ts`). */
const MARGEM_CABECALHO = 160

/** '45 min' · '2 h' · '2 h 05 min' */
export function formatarMinutos(min: number): string {
  const m = Math.max(0, Math.floor(min))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`
}

/**
 * O tempo parado da linha do posto. Em relógio corrido, de 48 h para cima vira dias ('9 d 2 h'); em
 * expediente fica em horas, porque um "dia" de expediente não é um dia de calendário.
 */
export function formatarTempoParado(min: number, expediente: boolean): string {
  const m = Math.max(0, Math.floor(min))
  if (expediente || m < 48 * 60) return formatarMinutos(m)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return h === 0 ? `${d} d` : `${d} d ${h} h`
}

export interface DadosParado extends ParOp {
  regraNome: string
  limiteHoras: number
  /** A regra conta horas de expediente (tem turno) em vez de relógio corrido. */
  expediente: boolean
  itens: readonly ItemParado[]
  em: Date
}

function linhaDoItem(i: ItemParado, expediente: boolean): string {
  const nome = i.tipo === 'conserto' ? `${i.codigo} (reprovadas, aguardando conserto)` : i.codigo
  const exemplos = i.amostras.length > 0 ? ` · ex.: ${i.amostras.join(', ')}` : ''
  return `• ${nome} · ${i.pecas} ${i.pecas === 1 ? 'peça' : 'peças'} · a mais antiga há ${formatarTempoParado(i.minutos, expediente)}${exemplos}`
}

/**
 * A mensagem do alerta "Parado ou travado na produção", UMA por OP. A primeira linha é o assunto do
 * e-mail: a OP, o total de peças e o limite. Depois, uma linha por posto (e uma a mais para as
 * reprovadas daquele posto) com quantas peças, a idade da mais antiga e alguns números de série. O
 * orçamento da lista é o que sobra dos 2000 do Discord depois do cabeçalho, do rodapé e da margem do
 * lembrete/reabertura; o que não cabe vira "… e mais N itens" (o Discord RECUSA a mensagem inteira
 * acima do limite, não corta).
 */
export function textoAlertaParado(d: DadosParado): string {
  const total = d.itens.reduce((s, i) => s + i.pecas, 0)
  const cabecalho =
    `⚠️ Parado na produção: OP ${textoOp(d)} com ${total} ${total === 1 ? 'peça parada' : 'peças paradas'} ` +
    `(limite ${d.limiteHoras} h${d.expediente ? ' de expediente' : ''})`
  const rodape = `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  const orcamento = LIMITE_MENSAGEM - MARGEM_CABECALHO - cabecalho.length - rodape.length - 2
  const lista = listaComCorte(d.itens.map((i) => linhaDoItem(i, d.expediente)), orcamento, 'item', 'itens', '\n')
  return [cabecalho, lista, rodape].filter((p) => p !== '').join('\n')
}

export function textoNormalizouParado(d: ParOp): string {
  return `🟢 Parado na produção: OP ${textoOp(d)} sem peças paradas`
}

/**
 * O lembrete do parado. A primeira linha é o assunto do e-mail, e o lembrete diário chega com a OP no
 * assunto (senão três e-mails de OPs diferentes teriam o mesmo "continua há N min"). O tempo é o de
 * relógio desde que o alerta abriu, em dias a partir de 48 h.
 */
export function textoLembreteParado(alerta: string, ref: ParOp, abertaEm: Date, em: Date): string {
  const min = Math.max(0, Math.floor((em.getTime() - abertaEm.getTime()) / 60_000))
  return `⏰ Lembrete — OP ${textoOp(ref)} · aberto há ${formatarTempoParado(min, false)}\n${alerta}`
}
