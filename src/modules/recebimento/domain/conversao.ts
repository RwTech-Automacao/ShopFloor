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

// Valida ano/mês/dia e retorna 'YYYY-MM-DD' (ou null se a data não existir,
// ex.: 31/02). Evita o Date() com fuso/rollover.
function montarISO(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null
  }
  const mm = String(mes).padStart(2, '0')
  const dd = String(dia).padStart(2, '0')
  return `${ano}-${mm}-${dd}`
}

// Datas em texto: aceita dd/mm/aaaa (padrão BR, com / ou -) e ISO aaaa-mm-dd.
// NÃO usa `new Date(texto)` para não interpretar dd/mm como mm/dd (americano).
function parseDataTextoBR(texto: string): string | null {
  const br = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (br) return montarISO(Number(br[3]), Number(br[2]), Number(br[1]))
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return montarISO(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  return null
}

// Números em texto no padrão BR: '.' = separador de milhar, ',' = decimal.
// Ex.: '1.500' → 1500 ; '1.500,50' → 1500.5 ; '10,5' → 10.5 ; '1481' → 1481.
function parseNumeroBR(texto: string): number {
  return Number(texto.replace(/\./g, '').replace(',', '.'))
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
    // Célula numérica do xlsx já chega como number — usa direto.
    if (typeof bruto === 'number') {
      return Number.isFinite(bruto)
        ? { ok: true, valor: bruto }
        : { ok: false, erro: 'Número inválido' }
    }
    const n = parseNumeroBR(texto)
    return Number.isFinite(n) ? { ok: true, valor: n } : { ok: false, erro: 'Número inválido' }
  }
  if (tipo === 'data') {
    if (typeof bruto === 'number') {
      const iso = serialParaISO(bruto)
      return iso ? { ok: true, valor: iso } : { ok: false, erro: 'Data inválida' }
    }
    const iso = parseDataTextoBR(texto)
    return iso
      ? { ok: true, valor: iso }
      : { ok: false, erro: 'Data inválida (use dd/mm/aaaa)' }
  }
  if (tipo === 'lista') {
    if (itensLista && !itensLista.includes(texto)) {
      return { ok: false, erro: 'Valor fora da lista' }
    }
    return { ok: true, valor: texto }
  }
  return { ok: true, valor: texto }
}
