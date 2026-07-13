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

    const linhasBrutas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null })
    const colunasBrutas = linhasBrutas[0] ? Object.keys(linhasBrutas[0]) : []

    // Texto da 1ª linha (cabeçalho) na mesma ordem das colunas — usado só para
    // saber quais colunas têm cabeçalho de verdade.
    const cabecalho = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })[0] ?? []) as unknown[]

    const ehVazio = (v: unknown) => v === null || v === undefined || String(v).trim() === ''
    const colunaTemDado = (chave: string) => linhasBrutas.some((l) => !ehVazio(l[chave]))

    // Descarta "colunas fantasma": as que a planilha carrega na área usada
    // (`!ref`) mas que não têm cabeçalho E não têm nenhum dado. Excel/Google
    // Sheets costumam guardar a área usada maior que os dados reais (por
    // formatação, bordas ou conteúdo antigo), e o SheetJS as expõe como colunas
    // vazias. Uma coluna com dados é sempre mantida, mesmo sem cabeçalho, para
    // nunca perder informação.
    const colunas = colunasBrutas.filter((chave, i) => !ehVazio(cabecalho[i]) || colunaTemDado(chave))

    // Remove as colunas descartadas também das linhas, para não trafegar lixo
    // adiante no wizard.
    const linhas =
      colunas.length === colunasBrutas.length
        ? linhasBrutas
        : linhasBrutas.map((l) => {
            const limpa: Record<string, unknown> = {}
            for (const c of colunas) limpa[c] = l[c]
            return limpa
          })

    return { colunas, linhas }
  } catch {
    return { colunas: [], linhas: [] }
  }
}
