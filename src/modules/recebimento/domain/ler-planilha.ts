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
/**
 * Troca a área usada declarada (`!ref`) pela área que as células realmente
 * ocupam. Google Sheets/LibreOffice gravam `A1:AMJ1048576` quando há formatação
 * de coluna/linha inteira, e `sheet_to_json` varreria ~1 milhão de linhas × 1.024
 * colunas (o navegador congela). Só olha as chaves da planilha, nunca a área.
 */
function aparaAreaUsada(ws: XLSX.WorkSheet): void {
  let maxL = -1
  let maxC = -1
  let minL = Infinity
  let minC = Infinity
  for (const chave of Object.keys(ws)) {
    if (chave.startsWith('!')) continue
    const { r, c } = XLSX.utils.decode_cell(chave)
    if (r < minL) minL = r
    if (c < minC) minC = c
    if (r > maxL) maxL = r
    if (c > maxC) maxC = c
  }
  if (maxL < 0) {
    delete ws['!ref']
    return
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: minL, c: minC }, e: { r: maxL, c: maxC } })
}

export async function lerPlanilha(file: File): Promise<PlanilhaLida> {
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: false })
    const nomeAba = wb.SheetNames[0]
    const ws = nomeAba ? wb.Sheets[nomeAba] : undefined
    if (!ws) return { colunas: [], linhas: [] }
    aparaAreaUsada(ws)

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
