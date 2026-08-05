export interface Conserto {
  codigo: string
}

/** trim + colapsa espaços internos + MAIÚSCULAS (mesmo padrão do catálogo de defeitos). */
export function normalizarCodigoConserto(bruto: string): string {
  return bruto.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function validarConserto(
  entrada: { codigo: string },
): { ok: true; valor: Conserto } | { ok: false; erro: string } {
  const codigo = normalizarCodigoConserto(entrada.codigo)
  if (codigo === '') return { ok: false, erro: 'Informe o código do conserto.' }
  return { ok: true, valor: { codigo } }
}
