import { normalizarNome, type CampoImportavel } from './mapeamento'

/** Mapa campo_do_banco → nome_da_coluna_da_planilha (o que um padrão guarda). */
export type MapeamentoSalvo = Record<string, string>

export interface ResultadoAplicarPadrao {
  /** campo_do_banco → nome_da_coluna, já casado com as colunas ATUAIS. */
  mapeamento: Record<string, string>
  /** Nomes de coluna do padrão que não existem na planilha atual (para o aviso). */
  colunasNaoEncontradas: string[]
}

/**
 * Aplica um padrão salvo às colunas da planilha atual. Casa cada coluna salva por
 * nome NORMALIZADO contra `colunasAtuais` e mapeia para o nome REAL da coluna atual.
 * Descarta campos que não estão mais em `camposMapeaveis` (desativados) sem marcá-los
 * como não encontrados. Substitui o mapeamento por completo. Não muta as entradas.
 */
export function aplicarPadrao(
  mapeamentoSalvo: MapeamentoSalvo,
  colunasAtuais: string[],
  camposMapeaveis: CampoImportavel[],
): ResultadoAplicarPadrao {
  const camposValidos = new Set(camposMapeaveis.map((c) => c.campo))
  const colunaPorNorma = new Map(colunasAtuais.map((c) => [normalizarNome(c), c]))

  const mapeamento: Record<string, string> = {}
  const colunasNaoEncontradas: string[] = []

  for (const [campo, colunaSalva] of Object.entries(mapeamentoSalvo)) {
    if (!camposValidos.has(campo)) continue // campo desativado: descarta em silêncio
    const colunaAtual = colunaPorNorma.get(normalizarNome(colunaSalva))
    if (colunaAtual) mapeamento[campo] = colunaAtual
    else colunasNaoEncontradas.push(colunaSalva)
  }

  return { mapeamento, colunasNaoEncontradas }
}

/** Nome de padrão é válido quando não é vazio após aparar os espaços. */
export function nomePadraoValido(nome: string): boolean {
  return nome.trim().length > 0
}
