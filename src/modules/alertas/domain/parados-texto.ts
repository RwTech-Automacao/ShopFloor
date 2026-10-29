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

export interface DadosParado extends ParOp {
  regraNome: string
  limiteHoras: number
  itens: readonly ItemParado[]
  em: Date
}

function linhaDoItem(i: ItemParado): string {
  if (i.tipo === 'peca') {
    return `• Peças avulsas · ${i.pecas} placas · a mais antiga há ${formatarMinutos(i.minutos)}`
  }
  const nome = i.tipo === 'lote' ? `Lote ${i.codigo}` : i.codigo
  return `• ${nome} · ${i.pecas} placas · ${formatarMinutos(i.minutos)}`
}

/**
 * A mensagem do alerta de parado, UMA por OP: o cabeçalho diz quantos itens e qual o limite, e cada
 * item vem numa linha (código, placas, tempo de expediente). O orçamento da lista é o que sobra dos
 * 2000 do Discord depois do cabeçalho, do rodapé e da margem do lembrete/reabertura; o que não cabe
 * vira "… e mais N itens" (o Discord RECUSA a mensagem inteira acima do limite, não corta).
 */
export function textoAlertaParado(d: DadosParado): string {
  const n = d.itens.length
  const cabecalho =
    `⚠️ Almoxarifado: OP ${textoOp(d)} com ${n} ${n === 1 ? 'item parado' : 'itens parados'} ` +
    `(limite ${d.limiteHoras} h de expediente)`
  const rodape = `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  const orcamento = LIMITE_MENSAGEM - MARGEM_CABECALHO - cabecalho.length - rodape.length - 2
  const lista = listaComCorte(d.itens.map(linhaDoItem), orcamento, 'item', 'itens', '\n')
  return [cabecalho, lista, rodape].filter((p) => p !== '').join('\n')
}

export function textoNormalizouParado(d: ParOp): string {
  return `🟢 Almoxarifado: OP ${textoOp(d)} sem itens parados`
}
