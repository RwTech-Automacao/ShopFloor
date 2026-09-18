import * as XLSX from 'xlsx'

/** Lê a planilha da composição do ERP no navegador. Aba "COMPOSIÇÃO DE PRODUTO" ou, se não houver, a primeira. */
export async function lerComposicaoXlsx(file: File): Promise<unknown[][]> {
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
    const nome = wb.SheetNames.find((n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase() === 'COMPOSICAO DE PRODUTO') ?? wb.SheetNames[0]
    if (!nome) return []
    return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome]!, { header: 1, defval: '' })
  } catch {
    return []
  }
}
