import { converterValor } from './conversao'
import type { CampoImportavel } from './mapeamento'

export type LinhaValidada = {
  valores: Record<string, string | number | null>
  erros: { campo: string; erro: string }[]
}

/**
 * Uma linha mapeada está "vazia" quando todos os campos do sistema resultam em
 * célula vazia (null/undefined/branco). Planilhas exportadas costumam trazer
 * linhas em branco no fim ou entre blocos — elas devem ser IGNORADAS (não
 * importadas nem contadas como erro), não tratadas como registros inválidos.
 */
export function linhaMapaVazia(
  linhaMapa: Record<string, unknown>,
  campos: CampoImportavel[],
): boolean {
  return campos.every((campo) => {
    const v = linhaMapa[campo.campo]
    return v === null || v === undefined || String(v).trim() === ''
  })
}

/**
 * Valida e converte uma linha já mapeada (chaves = `campo`, valores = célula
 * bruta da planilha). Para cada campo: converte pelo tipo declarado; erro de
 * conversão vira `{ campo, erro }`. Campos obrigatórios (`obrigatorioImportacao`)
 * que resultam em valor vazio (`null`/string vazia) também geram erro, mesmo
 * quando a conversão em si teve sucesso.
 */
export function validarLinha(
  linhaMapa: Record<string, unknown>,
  campos: CampoImportavel[],
  itensPorLista: Record<string, string[]>,
): LinhaValidada {
  const valores: Record<string, string | number | null> = {}
  const erros: { campo: string; erro: string }[] = []

  for (const campo of campos) {
    const bruto = linhaMapa[campo.campo]
    const itens = campo.listaChave ? itensPorLista[campo.listaChave] : undefined
    const r = converterValor(bruto, campo.tipo, itens)
    if (!r.ok) {
      erros.push({ campo: campo.campo, erro: r.erro })
      continue
    }
    if (campo.obrigatorioImportacao && (r.valor === null || r.valor === '')) {
      erros.push({ campo: campo.campo, erro: 'Campo obrigatório' })
    }
    valores[campo.campo] = r.valor
  }
  return { valores, erros }
}
