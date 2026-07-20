import { ehTerminal } from '@/modules/recebimento/domain/ciclo-vida'

export type ProcessoEtiqueta = {
  id: string
  status: string
  codigoMaterial: string | null
  numeroPedido: string | null
  diInpi: string | null
  numeroNf: string | null
  volumes: number | null
}
export type LinhaEtiqueta = { partNumber: string; codigo: string; volume: string }

function safe(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}
function onlyDigits(v: unknown): string {
  return safe(v).replace(/\D/g, '')
}
function padLeft(s: string, width: number): string {
  return s.length >= width ? s : '0'.repeat(width - s.length) + s
}

export function normalizarCodigo(codigo: unknown): string {
  return safe(codigo).replace(/-+$/, '')
}
export function formatarPedido(pedido: unknown): string {
  const p = safe(pedido)
  if (!p) return ''
  const m = p.match(/^\s*(\d+)\s*\/\s*(\d{2,4})\s*$/)
  if (m) {
    const num = padLeft(m[1]!, 4)
    let yy = m[2]!
    if (yy.length === 4) yy = yy.slice(-2)
    return `${num}${yy}`
  }
  const digits = onlyDigits(p)
  if (digits.length >= 6) return digits.slice(0, 4) + digits.slice(-2)
  return padLeft(digits, 4)
}
export function resolverDoc(diInpi: unknown, nf: unknown): string {
  const d = onlyDigits(diInpi)
  return d || onlyDigits(nf)
}
export function padSeq(i: number, total: number): string {
  const width = total >= 100 ? 3 : 2
  return padLeft(String(i), width)
}
export function formatarVolume(i: number, total: number): string {
  return `${padSeq(i, total)}-${padSeq(total, total)}`
}
export function montarPartNumber(codigoBase: string, pedidoFmt: string, doc: string, seq: string): string {
  return `${codigoBase}-${pedidoFmt}${doc}${seq}`
}

/** True sse o processo tem os campos da etiqueta: código, pedido, documento
 *  (DI/DUINPI ou NF) e volumes >= 1. */
export function camposCompletosEtiqueta(p: ProcessoEtiqueta): boolean {
  if (!normalizarCodigo(p.codigoMaterial)) return false
  if (!formatarPedido(p.numeroPedido)) return false
  if (!resolverDoc(p.diInpi, p.numeroNf)) return false
  const volumes = typeof p.volumes === 'number' ? p.volumes : Number(p.volumes)
  return Number.isFinite(volumes) && volumes >= 1
}

export type MotivoInelegivel = 'aguardando' | 'incompleto'

/** Elegibilidade para gerar etiqueta: status terminal (concluído — não aberto/
 *  em_conferencia) E campos completos. */
export function elegivelParaEtiqueta(
  p: ProcessoEtiqueta,
): { elegivel: boolean; motivo: MotivoInelegivel | null } {
  if (!ehTerminal(p.status)) return { elegivel: false, motivo: 'aguardando' }
  if (!camposCompletosEtiqueta(p)) return { elegivel: false, motivo: 'incompleto' }
  return { elegivel: true, motivo: null }
}

export function gerarEtiquetasDoProcesso(
  p: ProcessoEtiqueta,
): { incompleto: boolean; etiquetas: LinhaEtiqueta[] } {
  if (!camposCompletosEtiqueta(p)) return { incompleto: true, etiquetas: [] }
  const codigoBase = normalizarCodigo(p.codigoMaterial)
  const pedidoFmt = formatarPedido(p.numeroPedido)
  const doc = resolverDoc(p.diInpi, p.numeroNf)
  const volumes = Math.trunc(Number(p.volumes))
  const etiquetas: LinhaEtiqueta[] = []
  for (let i = 1; i <= volumes; i++) {
    const seq = padSeq(i, volumes)
    etiquetas.push({
      partNumber: montarPartNumber(codigoBase, pedidoFmt, doc, seq),
      codigo: codigoBase,
      volume: formatarVolume(i, volumes),
    })
  }
  return { incompleto: false, etiquetas }
}

export function gerarCsv(linhas: LinhaEtiqueta[]): string {
  const aspas = (c: string) => `"${String(c).replace(/"/g, '""')}"`
  return linhas.map((l) => [l.partNumber, l.codigo, l.volume].map(aspas).join(',')).join('\r\n')
}
