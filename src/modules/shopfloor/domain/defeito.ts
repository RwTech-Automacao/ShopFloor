export type TipoDefeito = 1 | 2

export interface Defeito {
  codigo: string
  tipo: TipoDefeito
}

/** trim + colapsa espaços internos + MAIÚSCULAS (fiel ao catálogo legado). */
export function normalizarCodigoDefeito(bruto: string): string {
  return bruto.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function validarDefeito(
  entrada: { codigo: string; tipo: number },
): { ok: true; valor: Defeito } | { ok: false; erro: string } {
  const codigo = normalizarCodigoDefeito(entrada.codigo)
  if (codigo === '') return { ok: false, erro: 'Informe o código do defeito.' }
  if (entrada.tipo !== 1 && entrada.tipo !== 2) {
    return { ok: false, erro: 'Selecione o tipo (peça ou teste).' }
  }
  return { ok: true, valor: { codigo, tipo: entrada.tipo } }
}
