import { CELULA_PENDENTE, CELULA_SEM_MANUTENCAO, type LinhaGrade } from './grade'

/**
 * Filtro por coluna da Grade Geral (estilo Excel).
 *
 * - `sn`: texto que o Nº de Série deve CONTER (sem diferenciar maiúsculas; vazio = sem filtro).
 * - `valores`: por coluna (posto, Embalagem, Manutenção…), os valores marcados. Coluna ausente =
 *   sem filtro. Dentro da coluna, os valores combinam com OU; colunas diferentes (e o SN), com E.
 *   Lista vazia = nada marcado = nenhuma linha passa (como desmarcar tudo no Excel).
 */
export interface FiltrosColuna {
  sn: string
  valores: Record<string, string[]>
}

export const FILTROS_VAZIOS: FiltrosColuna = { sn: '', valores: {} }

/** Rótulo da célula "vazia" — a peça que ainda não passou pelo posto. */
export const VAZIO = '(vazio)'

/**
 * Valor da célula para o filtro. A grade mostra "Pendente" (posto) ou "—" (Manutenção) quando a
 * peça ainda não passou por ali; no filtro isso é o "(vazio)" do Excel.
 */
export function valorFiltro(celula: string | undefined): string {
  const v = (celula ?? '').trim()
  if (v === '' || v === CELULA_PENDENTE || v === CELULA_SEM_MANUTENCAO) return VAZIO
  return v
}

/** Normaliza pra comparação "contém" ignorando separadores (traço, ponto, espaço…) e maiúsculas. */
function limparParaBusca(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

/** Valores distintos da coluna, ordenados (numérico-aware, pt-BR) com "(vazio)" no fim. */
export function valoresDistintos(linhas: LinhaGrade[], coluna: string): string[] {
  const set = new Set<string>()
  let temVazio = false
  for (const l of linhas) {
    const v = valorFiltro(l.celulas[coluna])
    if (v === VAZIO) temVazio = true
    else set.add(v)
  }
  const out = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  if (temVazio) out.push(VAZIO)
  return out
}

/** Há algum filtro de coluna ativo? */
export function temFiltroAtivo(f: FiltrosColuna): boolean {
  return f.sn.trim() !== '' || Object.keys(f.valores).length > 0
}

/** Aplica os filtros de coluna (E entre colunas, OU dentro da coluna). Sem filtro = tudo. */
export function filtrarLinhas(linhas: LinhaGrade[], f: FiltrosColuna): LinhaGrade[] {
  const texto = limparParaBusca(f.sn)
  const cols = Object.entries(f.valores).map(([c, vs]) => [c, new Set(vs)] as const)
  if (texto === '' && cols.length === 0) return linhas
  return linhas.filter((l) => {
    if (texto !== '' && !limparParaBusca(l.sn).includes(texto)) return false
    for (const [c, set] of cols) {
      if (!set.has(valorFiltro(l.celulas[c]))) return false
    }
    return true
  })
}
