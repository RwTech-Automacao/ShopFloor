import { cortarUtf16, textoOp } from './mensagens'

/**
 * A ficha de apontamento que o Almoxarifado entregava em papel junto da caixa (pedido de 06/11/2026), agora
 * mandada pelo Discord quando uma caixa ou um lote vira necessidade. Fora da ficha, de propósito: data de
 * inspeção e responsável pela conferência.
 */
export interface DadosFicha {
  unidade: 'caixa' | 'lote'
  /** O que o Almoxarifado bipa: `CX[1][160]8682_F-PMOF52_F` (caixa) ou `LOTE[03ec5112][6]` (lote). Também é o QR. */
  codigo: string
  /** Quando a caixa foi fechada (ou o lote, aprovado). Nulo = não se sabe. */
  dataProducao: Date | null
  /** Descrição do produto da OP. */
  produto: string
  /** Quantidade da OP. */
  quantidadeOp: number | null
  pmo: string
  op: string
  /** Peças da caixa ou do lote. */
  quantidadeApontada: number
  /** Quem fechou a caixa (colaborador do último bipe). */
  responsavel: string
}

const VAZIO = '—'
/** Campos livres (descrição do produto, nome) cedem o limite do Discord se vierem gigantes. */
const MAX_CAMPO = 200

function texto(v: string): string {
  const t = v.trim()
  return t === '' ? VAZIO : cortarUtf16(t, MAX_CAMPO)
}

/** '05/11/2026', no dia da fábrica (São Paulo). */
function data(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return VAZIO
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

function numero(v: number | null): string {
  return v === null || !Number.isFinite(v) ? VAZIO : v.toLocaleString('pt-BR')
}

/**
 * ⚠️ A PRIMEIRA LINHA É O ASSUNTO DO E-MAIL: diz sozinha a OP e se é caixa ou lote. PMO e OP aparecem de
 * novo, cada um na sua linha, como na ficha de papel. O QR vai como imagem anexada (o `codigo` entra em
 * `dados.qr` do envio), e o código também fica no texto, para quem lê por canal que não anexa.
 */
export function textoFicha(d: DadosFicha): string {
  const rotulo = d.unidade === 'lote' ? 'Lote' : 'Caixa'
  return [
    `📋 Ficha de apontamento · OP ${textoOp({ pmo: d.pmo, op: d.op })} · ${rotulo} ${d.codigo}`,
    `Data de produção: ${data(d.dataProducao)}`,
    `Produto: ${texto(d.produto)}`,
    `Quantidade da OP: ${numero(d.quantidadeOp)}`,
    `PMO: ${texto(d.pmo)}`,
    `OP: ${texto(d.op)}`,
    `Quantidade apontada: ${numero(d.quantidadeApontada)}`,
    `Responsável: ${texto(d.responsavel)}`,
  ].join('\n')
}
