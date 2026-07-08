import * as XLSX from 'xlsx'

export interface PlanilhaLida {
  colunas: string[]
  linhas: Record<string, unknown>[]
}

/**
 * Lê a primeira aba de uma planilha `.xlsx`/`.csv` inteiramente no navegador
 * (SheetJS) — o arquivo bruto nunca é enviado ao servidor, só o resultado
 * estruturado (colunas + linhas) segue adiante no wizard. Único arquivo do
 * projeto que importa `xlsx`.
 *
 * Parsing é defensivo: qualquer falha (arquivo corrompido, formato
 * inesperado) resulta em `{ colunas: [], linhas: [] }` — quem chama decide
 * como sinalizar isso ao usuário.
 */
export async function lerPlanilha(file: File): Promise<PlanilhaLida> {
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: false })
    const nomeAba = wb.SheetNames[0]
    const ws = nomeAba ? wb.Sheets[nomeAba] : undefined
    if (!ws) return { colunas: [], linhas: [] }

    const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
    const primeiraLinha = linhas[0]
    const colunas = primeiraLinha ? Object.keys(primeiraLinha) : []
    return { colunas, linhas }
  } catch {
    return { colunas: [], linhas: [] }
  }
}
