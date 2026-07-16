export type DirecaoSub = 'asc' | 'desc'

/** Filtro de uma coluna: busca por texto e/ou valores marcados no checkbox. */
export type FiltroColunaSub = { texto?: string; valores?: string[] }

export interface SubFiltroEtiquetas {
  ordenar: string | null // coluna, ou null = ordem original (numero desc do servidor)
  direcao: DirecaoSub
  filtros: Record<string, FiltroColunaSub>
}

export const SUB_FILTRO_PADRAO: SubFiltroEtiquetas = { ordenar: null, direcao: 'asc', filtros: {} }

/** Valor comparável de uma coluna, para uma linha. `numero` devolve number
 *  (ordena numericamente); o resto devolve string. */
export type Acessor<T> = (linha: T) => string | number | null

function ehVazio(v: string | number | null): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/** Valores distintos de uma coluna, a partir das linhas — para o checkbox.
 *  Ordenados (pt-BR, numérico-aware); vazios/nulos omitidos. */
export function valoresDistintosSub<T>(linhas: T[], acessor: Acessor<T>): string[] {
  const set = new Set<string>()
  for (const linha of linhas) {
    const v = acessor(linha)
    if (ehVazio(v)) continue
    set.add(String(v))
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
}

/** Aplica busca por texto + checkbox de valores e a ordenação, em memória.
 *  Não muta a entrada. Vazios vão sempre para o fim na ordenação. */
export function aplicarSubFiltro<T>(
  linhas: T[],
  subFiltro: SubFiltroEtiquetas,
  acessores: Record<string, Acessor<T>>,
): T[] {
  const filtradas = linhas.filter((linha) => {
    for (const [campo, filtro] of Object.entries(subFiltro.filtros)) {
      const acessor = acessores[campo]
      if (!acessor) continue // coluna desconhecida: ignora
      const bruto = acessor(linha)
      const valor = bruto === null || bruto === undefined ? '' : String(bruto)
      if (filtro.texto && !valor.toLowerCase().includes(filtro.texto.toLowerCase())) return false
      if (filtro.valores && filtro.valores.length > 0 && !filtro.valores.includes(valor)) return false
    }
    return true
  })

  const acessorOrdem = subFiltro.ordenar ? acessores[subFiltro.ordenar] : undefined
  if (!acessorOrdem) return filtradas

  const dir = subFiltro.direcao === 'asc' ? 1 : -1
  return [...filtradas].sort((a, b) => {
    const va = acessorOrdem(a)
    const vb = acessorOrdem(b)
    const ea = ehVazio(va)
    const eb = ehVazio(vb)
    if (ea && eb) return 0
    if (ea) return 1 // vazio sempre por último
    if (eb) return -1
    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })
    return dir * cmp
  })
}
