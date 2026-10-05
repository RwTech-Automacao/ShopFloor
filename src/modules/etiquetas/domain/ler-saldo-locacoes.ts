/**
 * Leitura do export "Saldo por Locação" do ERP (xlsx) para a etiquetagem do estoque legado.
 *
 * A planilha não começa no cabeçalho: vêm antes as linhas de EMPRESA e FILTROS, e só depois a
 * linha com CÓDIGO ITEM / DESCRIÇÃO ITEM / LOCAÇÃO / ... Por isso a leitura é por posição
 * (`header: 1`) e o cabeçalho é PROCURADO, em vez de assumido na primeira linha.
 *
 * Só três colunas interessam: código do item, descrição e locação. Saldo, unidade, peso, categoria
 * e negociante são ignorados de propósito (a unidade, aliás, vem em três grafias diferentes na
 * mesma planilha).
 */

import * as XLSX from 'xlsx'
import type { LinhaSaldo } from './partnumber-legado'

/** Nome da aba que o ERP gera. Não achando, usa a primeira. */
const ABA_PADRAO = 'SALDO POR LOCACAO'

/** Cabeçalhos aceitos por coluna, já sem acento e em maiúsculas. */
const CABECALHOS = {
  item: ['CODIGO ITEM', 'CODIGO DO ITEM', 'ITEM'],
  descricao: ['DESCRICAO ITEM', 'DESCRICAO DO ITEM', 'DESCRICAO'],
  locacao: ['LOCACAO', 'LOCALIZACAO'],
} as const

export interface PlanilhaSaldo {
  linhas: LinhaSaldo[]
  /** Preenchido quando a planilha não pôde ser lida — a tela mostra e não segue adiante. */
  erro: string | null
}

/** Sem acento, sem espaço duplicado, maiúsculas — para comparar cabeçalho de planilha. */
function achatar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** Índice da linha de cabeçalho: a primeira que tem uma célula de "código do item". */
function acharCabecalho(grade: unknown[][]): number {
  return grade.findIndex((linha) =>
    (linha ?? []).some((celula) => (CABECALHOS.item as readonly string[]).includes(achatar(celula))),
  )
}

/** Posição de cada coluna que interessa na linha de cabeçalho. -1 = não achou. */
function acharColunas(cabecalho: unknown[]): { item: number; descricao: number; locacao: number } {
  const achar = (aceitos: readonly string[]) =>
    cabecalho.findIndex((celula) => aceitos.includes(achatar(celula)))
  return {
    item: achar(CABECALHOS.item),
    descricao: achar(CABECALHOS.descricao),
    locacao: achar(CABECALHOS.locacao),
  }
}

/**
 * A grade de células (como o SheetJS entrega com `header: 1`) nas linhas de rolo. Função pura: é
 * onde mora a regra de onde começa a tabela e qual coluna é qual.
 *
 * `linhaPlanilha` é 1-based, como o Excel numera — é assim que o usuário acha a linha do problema.
 * Linhas totalmente vazias são descartadas (o export costuma terminar com algumas); linha com
 * item vazio SEGUE adiante, porque quem recusa e conta é o domínio (`avaliarLinhas`).
 */
export function extrairLinhasSaldo(grade: unknown[][]): PlanilhaSaldo {
  const iCabecalho = acharCabecalho(grade)
  if (iCabecalho < 0) {
    return { linhas: [], erro: 'Não encontrei a coluna "Código Item" na planilha. É o export "Saldo por Locação" do ERP?' }
  }

  const colunas = acharColunas(grade[iCabecalho] ?? [])
  if (colunas.locacao < 0) {
    return { linhas: [], erro: 'Não encontrei a coluna "Locação" na planilha.' }
  }

  const linhas: LinhaSaldo[] = []
  for (let i = iCabecalho + 1; i < grade.length; i++) {
    const celulas = grade[i] ?? []
    const vazia = celulas.every((c) => String(c ?? '').trim() === '')
    if (vazia) continue
    linhas.push({
      linhaPlanilha: i + 1,
      item: String(celulas[colunas.item] ?? '').trim(),
      descricao: colunas.descricao < 0 ? '' : String(celulas[colunas.descricao] ?? '').trim(),
      locacao: String(celulas[colunas.locacao] ?? '').trim(),
    })
  }

  if (linhas.length === 0) return { linhas: [], erro: 'A planilha não tem nenhuma linha de estoque.' }
  return { linhas, erro: null }
}

/**
 * Lê a planilha no NAVEGADOR (SheetJS) — o arquivo bruto nunca é enviado ao servidor, só item e
 * locação seguem para a geração. Qualquer falha de leitura volta como erro para a tela mostrar.
 */
export async function lerSaldoLocacoesXlsx(file: File): Promise<PlanilhaSaldo> {
  let grade: unknown[][]
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
    const nome = wb.SheetNames.find((n) => achatar(n) === ABA_PADRAO) ?? wb.SheetNames[0]
    const aba = nome ? wb.Sheets[nome] : undefined
    if (!aba) return { linhas: [], erro: 'A planilha não tem nenhuma aba com dados.' }
    grade = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, defval: '' })
  } catch {
    return { linhas: [], erro: 'Não consegui ler a planilha. Confira se é um arquivo .xlsx válido.' }
  }
  return extrairLinhasSaldo(grade)
}
