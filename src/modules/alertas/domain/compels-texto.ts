import { LIMITE_MENSAGEM, cortarUtf16, formatarDataHoraCurta, listaComCorte, textoOp, type ParOp } from './mensagens'

/** Margem que o lembrete e a reabertura acrescentam acima do texto (mesma de `mensagens.ts`). */
const MARGEM_CABECALHO = 160

/** Um motivo de problema na fila do Compels: o texto gravado em `sf_estoque_envios.erro`, com quantas linhas o repetem. */
export interface ItemCompels {
  motivo: string
  linhas: number
  pecas: number
  /** Alguma linha com este motivo já gastou as 5 tentativas: a fila parou de tentar. */
  desistiu: boolean
}

/** Um aviso de gravação: a entrada FOI enviada, com ressalva (`sf_estoque_envios.aviso`). */
export interface AvisoCompels {
  pmo: string
  op: string
  quantidade: number
  aviso: string
}

export interface DadosCompels extends ParOp {
  regraNome: string
  /** Quantas linhas da fila da OP estão com problema. */
  linhas: number
  itens: readonly ItemCompels[]
  em: Date
}

/** O motivo vem do Compels (ou de uma exceção): um texto gigante cederia o limite do Discord. */
const MAX_MOTIVO = 300

const n = (v: number, s: string, p: string) => `${v} ${v === 1 ? s : p}`

function linhaDoItem(i: ItemCompels): string {
  const partes = [cortarUtf16(i.motivo.trim(), MAX_MOTIVO), n(i.linhas, 'linha', 'linhas'), n(i.pecas, 'peça', 'peças')]
  if (i.desistiu) partes.push('parou de tentar')
  return `• ${partes.join(' · ')}`
}

/**
 * O alerta de problema no envio ao Compels, UMA mensagem por OP.
 *
 * ⚠️ A PRIMEIRA LINHA É O ASSUNTO DO E-MAIL: tem de dizer sozinha a OP e quantas linhas travaram.
 * O corte da lista é o mesmo das outras (`listaComCorte`): o Discord RECUSA a mensagem inteira
 * acima de 2000, não corta — "… e mais N motivos" avisa que a lista continua na tela de pendências.
 */
export function textoAlertaCompels(d: DadosCompels): string {
  const cabecalho = `⚠️ Compels: OP ${textoOp(d)} com ${n(d.linhas, 'linha', 'linhas')} sem apontar no ERP`
  const rodape = `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  const orcamento = LIMITE_MENSAGEM - MARGEM_CABECALHO - cabecalho.length - rodape.length - 2
  const lista = listaComCorte(d.itens.map(linhaDoItem), orcamento, 'motivo', 'motivos', '\n')
  return [cabecalho, lista, rodape].filter((p) => p !== '').join('\n')
}

export function textoNormalizouCompels(d: ParOp): string {
  return `🟢 Compels: OP ${textoOp(d)} sem problemas no envio`
}

/**
 * Os avisos de gravação novos de uma rodada, numa mensagem só (sem botão, sem ocorrência: o aviso de
 * uma entrada já enviada é permanente e não há o que "resolver"). Cada linha: a OP, as peças e o que o
 * Compels/a integração avisou.
 */
export function textoAvisosCompels(regraNome: string, em: Date, avisos: readonly AvisoCompels[]): string {
  const cabecalho = `ℹ️ Compels: ${n(avisos.length, 'entrada gravada', 'entradas gravadas')} com ressalva`
  const rodape = `Regra: ${regraNome} · ${formatarDataHoraCurta(em)}`
  const orcamento = LIMITE_MENSAGEM - cabecalho.length - rodape.length - 2
  const lista = listaComCorte(
    avisos.map(
      (a) =>
        `• OP ${textoOp({ pmo: a.pmo, op: a.op })} · ${n(a.quantidade, 'peça', 'peças')} — ${cortarUtf16(a.aviso.trim(), MAX_MOTIVO)}`,
    ),
    orcamento,
    'aviso',
    'avisos',
    '\n',
  )
  return [cabecalho, lista, rodape].filter((p) => p !== '').join('\n')
}
