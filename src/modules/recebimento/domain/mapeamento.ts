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
