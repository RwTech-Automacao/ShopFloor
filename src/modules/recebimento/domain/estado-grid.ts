import { inicioProximoMes } from './agrupamento-mes'

/** Filtro de uma coluna: busca por texto e/ou valores marcados no checkbox (estilo Excel). */
export type FiltroColuna = { texto?: string; valores?: string[] }

export interface EstadoGrid {
  ordenar: string
  direcao: 'asc' | 'desc'
  pagina: number // 0-based
  tamanho: number // linhas por página (seletor da UI)
  filtros: Record<string, FiltroColuna>
}

export const TAMANHOS_PAGINA = [25, 50, 100, 200] as const

export const ESTADO_GRID_PADRAO: EstadoGrid = {
  ordenar: 'numero',
  direcao: 'desc',
  pagina: 0,
  tamanho: 50,
  filtros: {},
}

/** Serializa o estado para caber num parâmetro de URL. NÃO faz percent-encoding:
 *  quem monta a URL (via URLSearchParams) é que codifica, e o Next já entrega o
 *  parâmetro decodificado do outro lado. Codificar aqui causaria decode duplo. */
export function codificarEstadoGrid(estado: EstadoGrid): string {
  return JSON.stringify(estado)
}

/**
 * Decodifica o estado do parâmetro da URL **validando tudo**: o param é digitável pelo
 * usuário, então nada dele é confiável. Coluna fora de `colunasValidas` (ordenação ou
 * filtro) é descartada — é a defesa que impede um nome de coluna arbitrário chegar à
 * consulta. Qualquer inconsistência degrada para o padrão em vez de quebrar a tela.
 */
export function decodificarEstadoGrid(
  param: string | undefined,
  colunasValidas: string[],
): EstadoGrid {
  if (!param) return { ...ESTADO_GRID_PADRAO, filtros: {} }

  let bruto: unknown
  try {
    bruto = JSON.parse(param)
  } catch {
    return { ...ESTADO_GRID_PADRAO, filtros: {} }
  }
  if (!bruto || typeof bruto !== 'object') return { ...ESTADO_GRID_PADRAO, filtros: {} }

  const o = bruto as Record<string, unknown>
  const validas = new Set(colunasValidas)

  const ordenar =
    typeof o.ordenar === 'string' && validas.has(o.ordenar) ? o.ordenar : ESTADO_GRID_PADRAO.ordenar
  const direcao: 'asc' | 'desc' = o.direcao === 'asc' ? 'asc' : 'desc'
  const pagina =
    typeof o.pagina === 'number' && Number.isInteger(o.pagina) && o.pagina > 0 ? o.pagina : 0
  const tamanho =
    typeof o.tamanho === 'number' && (TAMANHOS_PAGINA as readonly number[]).includes(o.tamanho)
      ? o.tamanho
      : ESTADO_GRID_PADRAO.tamanho

  const filtros: Record<string, FiltroColuna> = {}
  if (o.filtros && typeof o.filtros === 'object') {
    for (const [campo, cru] of Object.entries(o.filtros as Record<string, unknown>)) {
      if (!validas.has(campo)) continue // coluna desconhecida/adulterada: descarta
      if (!cru || typeof cru !== 'object') continue
      const f = cru as Record<string, unknown>
      const filtro: FiltroColuna = {}
      if (typeof f.texto === 'string' && f.texto.trim() !== '') filtro.texto = f.texto
      if (Array.isArray(f.valores)) {
        const valores = f.valores.filter((v): v is string => typeof v === 'string')
        if (valores.length > 0) filtro.valores = valores
      }
      if (filtro.texto !== undefined || filtro.valores !== undefined) filtros[campo] = filtro
    }
  }

  return { ordenar, direcao, pagina, tamanho, filtros }
}

/** Faixa semiaberta de datas de um mês: `>= inicio` e `< fim`. */
export interface FaixaMes {
  inicio: string
  fim: string
}

/**
 * Faixa de datas de um mês `'YYYY-MM'`. `null` quando não há faixa: `'sem_data'` (que vira
 * filtro de nulo) ou valor inválido. Usada para traduzir o filtro de MÊS de uma coluna de
 * data em condições de data na consulta.
 */
export function faixaDoMes(chave: string): FaixaMes | null {
  if (!/^\d{4}-\d{2}$/.test(chave)) return null
  return { inicio: `${chave}-01`, fim: inicioProximoMes(chave) }
}
