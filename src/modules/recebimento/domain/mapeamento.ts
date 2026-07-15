export type CampoImportavel = {
  campo: string
  rotulo: string
  tipo: 'texto' | 'lista' | 'numero' | 'data'
  listaChave: string | null
  obrigatorioImportacao: boolean
}

/**
 * Normaliza um nome de coluna/rótulo para comparação: remove acentos
 * (via decomposição NFD + remoção das marcas combinantes), reduz para
 * minúsculas e colapsa qualquer sequência de não-alfanuméricos em um
 * único espaço, aparado nas pontas.
 */
export function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Sugere, para cada campo importável, qual coluna da planilha corresponde
 * a ele — por igualdade do nome normalizado (rótulo do campo vs. cabeçalho
 * da coluna). Campos sem coluna correspondente ficam de fora do resultado.
 */
export function sugerirMapeamento(
  colunas: string[],
  campos: CampoImportavel[],
): Record<string, string> {
  const porNorma = new Map(colunas.map((c) => [normalizarNome(c), c]))
  const sugestao: Record<string, string> = {}
  for (const campo of campos) {
    const alvo = porNorma.get(normalizarNome(campo.rotulo))
    if (alvo) sugestao[campo.campo] = alvo
  }
  return sugestao
}

/**
 * Campos que NÃO são mapeados de coluna: o usuário digita/edita o valor uma vez
 * no wizard e ele vale para TODAS as linhas da planilha. Os itens de uma
 * importação chegam juntos, então data de chegada e Nº EMB são os mesmos para
 * todos — mapear coluna para eles criaria duas fontes para o mesmo dado.
 */
export const CAMPOS_DIGITADOS: readonly string[] = ['data_chegada', 'numero_emb']

/**
 * Nº EMB a partir do nome do arquivo importado: os 8 primeiros caracteres
 * ('EMB341EA - ESTADOS UNIDOS.xlsx' → 'EMB341EA'). Nome mais curto devolve o que
 * houver, e espaços nas pontas são aparados. É só o pré-preenchimento — o campo
 * é editável no wizard.
 */
export function numeroEmbDoArquivo(nomeArquivo: string): string {
  return nomeArquivo.slice(0, 8).trim()
}
