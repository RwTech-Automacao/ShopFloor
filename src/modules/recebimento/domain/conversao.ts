import type { CampoImportavel } from './mapeamento'

export type ResultadoConversao =
  | { ok: true; valor: string | number | null }
  | { ok: false; erro: string }

// Data serial do Excel (base 1899-12-30) → 'YYYY-MM-DD'.
function serialParaISO(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * Converte um valor bruto (vindo de célula de planilha) para o tipo
 * esperado do campo. Vazio (null/undefined/string em branco) sempre vira
 * `{ ok: true, valor: null }` — a obrigatoriedade é responsabilidade de
 * `validarLinha`, não desta função.
 */
export function converterValor(
  bruto: unknown,
  tipo: CampoImportavel['tipo'],
  itensLista?: string[],
): ResultadoConversao {
  const vazio = bruto === null || bruto === undefined || String(bruto).trim() === ''
  if (vazio) return { ok: true, valor: null }
  const texto = String(bruto).trim()

  if (tipo === 'numero') {
    const n = Number(texto.replace(',', '.'))
    return Number.isFinite(n) ? { ok: true, valor: n } : { ok: false, erro: 'Número inválido' }
  }
  if (tipo === 'data') {
    if (typeof bruto === 'number') {
      const iso = serialParaISO(bruto)
      return iso ? { ok: true, valor: iso } : { ok: false, erro: 'Data inválida' }
    }
    const d = new Date(texto)
    return Number.isNaN(d.getTime())
      ? { ok: false, erro: 'Data inválida' }
      : { ok: true, valor: d.toISOString().slice(0, 10) }
  }
  if (tipo === 'lista') {
    if (itensLista && !itensLista.includes(texto)) {
      return { ok: false, erro: 'Valor fora da lista' }
    }
    return { ok: true, valor: texto }
  }
  return { ok: true, valor: texto }
}
