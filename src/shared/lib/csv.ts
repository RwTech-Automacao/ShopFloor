/**
 * Campo de CSV (separador `;`) seguro pra abrir no Excel/Calc:
 *  - "CSV injection": célula que começa com = + - @ (ou tab/CR) vira FÓRMULA ao abrir o arquivo —
 *    um texto livre digitado no chão de fábrica (ex.: Colaborador) poderia executar algo no Excel de
 *    quem exporta. Prefixamos com aspas simples, que o Excel mostra como texto literal.
 *  - Envolve em aspas (duplicando as internas) quando há separador, vírgula, aspas ou quebra de linha.
 *    A vírgula entra porque o Excel/Calc costuma importar com vírgula marcada também.
 */
export function campoCsv(valor: string | number | null | undefined): string {
  const v = valor == null ? '' : String(valor)
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[;,"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}
