import { LIMITE_MENSAGEM, formatarDataHoraCurta, listaComCorte } from './mensagens'
import type { ItemParado } from './parados'

/** Margem que a reabertura acrescenta acima do texto (mesma de `mensagens.ts`). */
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
 * A idade da peça mais antiga na linha da OP. Em relógio corrido, de 1 dia para cima vira '9d'; em
 * expediente fica em horas ('216 h'), porque um "dia" de expediente não é um dia de calendário.
 */
export function formatarIdadeParado(min: number, expediente: boolean): string {
  const m = Math.max(0, Math.floor(min))
  if (expediente || m < 1440) return formatarMinutos(m)
  return `${Math.floor(m / 1440)}d`
}

/** O limite da regra: em dias quando é múltiplo de 24 h, senão em horas ('7 dias' · '1 dia' · '36 h'). */
export function formatarLimiteParado(horas: number, expediente: boolean): string {
  const sufixo = expediente ? ' de expediente' : ''
  if (horas >= 24 && horas % 24 === 0) {
    const d = horas / 24
    return `${d} ${d === 1 ? 'dia' : 'dias'}${sufixo}`
  }
  return `${horas} h${sufixo}`
}

/** Uma OP do relatório: o que está parado nela, por posto. */
export interface OpParada {
  pmo: string
  op: string
  maisAntigaMin: number
  itens: readonly Pick<ItemParado, 'tipo' | 'codigo' | 'pecas' | 'minutos'>[]
}

export interface DadosParado {
  regraNome: string
  limiteHoras: number
  /** A regra conta horas de expediente (tem turno) em vez de relógio corrido. */
  expediente: boolean
  ops: readonly OpParada[]
  em: Date
}

const pecasTexto = (n: number) => `${n} ${n === 1 ? 'peça' : 'peças'}`

function linhaDaOp(o: OpParada, expediente: boolean): string {
  const total = o.itens.reduce((s, i) => s + i.pecas, 0)
  const postos = o.itens.filter((i) => i.tipo === 'posto').map((i) => `${i.codigo} (${i.pecas})`)
  const consertos = o.itens.filter((i) => i.tipo === 'conserto').map((i) => `${i.codigo} (${i.pecas})`)
  const partes = [`${o.pmo}/${o.op}`, pecasTexto(total), `mais antiga há ${formatarIdadeParado(o.maisAntigaMin, expediente)}`]
  if (postos.length > 0) partes.push(postos.join(', '))
  const linhas = [partes.join(' · ')]
  if (consertos.length > 0) linhas.push(`   ↳ reprovadas, aguardando conserto: ${consertos.join(', ')}`)
  return linhas.join('\n')
}

/** Da mais antiga para a mais nova (desempate estável por PMO/OP). */
function ordenadas(ops: readonly OpParada[]): OpParada[] {
  return [...ops].sort(
    (a, b) => b.maisAntigaMin - a.maisAntigaMin || a.pmo.localeCompare(b.pmo) || a.op.localeCompare(b.op),
  )
}

/**
 * O RELATÓRIO ÚNICO do alerta "Parado ou travado na produção" (uma mensagem por regra, não por OP). A
 * primeira linha é o assunto do e-mail: "⏰ N peças paradas há mais de X em M OPs". Depois, uma linha por
 * OP, da mais antiga para a mais nova, e o rodapé da regra. A lista cabe no que sobra dos 2000 do
 * Discord (que RECUSA a mensagem inteira acima do limite): o que não cabe vira "… e mais K OPs", e o
 * cabeçalho e o rodapé ficam sempre. O mesmo texto serve ao alerta e a cada lembrete.
 */
export function textoRelatorioParado(d: DadosParado): string {
  const total = d.ops.reduce((s, o) => s + o.itens.reduce((t, i) => t + i.pecas, 0), 0)
  const n = d.ops.length
  const cabecalho =
    `⏰ ${pecasTexto(total)} ${total === 1 ? 'parada' : 'paradas'} há mais de ${formatarLimiteParado(d.limiteHoras, d.expediente)} ` +
    `em ${n} ${n === 1 ? 'OP' : 'OPs'}`
  const rodape = `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  const orcamento = LIMITE_MENSAGEM - MARGEM_CABECALHO - cabecalho.length - rodape.length - 2
  const lista = listaComCorte(ordenadas(d.ops).map((o) => linhaDaOp(o, d.expediente)), orcamento, 'OP', 'OPs', '\n')
  return [cabecalho, lista, rodape].filter((p) => p !== '').join('\n')
}

export function textoNormalizouParado(): string {
  return '🟢 Parado na produção: sem peças paradas'
}
