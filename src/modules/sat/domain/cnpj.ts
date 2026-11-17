/**
 * CNPJ (14 dígitos) ou CPF (11) da nota de entrada (spec 2026-11-17-sat-entrada-por-nf-design.md, decisão 3).
 * Gravado com máscara — a mesma regra de `sat__cnpj` no banco (0187).
 */
export function digitosCnpj(texto: string): string {
  return (texto ?? '').replace(/\D/g, '')
}

/** 14 dígitos → `99.999.999/9999-99`; 11 → `999.999.999-99`; outra coisa → null. */
export function formatarCnpj(texto: string): string | null {
  const d = digitosCnpj(texto)
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return null
}
