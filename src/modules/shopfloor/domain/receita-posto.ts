/** Receita da Integração por posto: chave do posto → PMOs de placa que ele integra. */
export type ReceitaPorPosto = Record<string, string[]>

/** Agrupa linhas do banco (sf_ordem_componentes) em receita por posto, preservando ordem e sem duplicar. */
export function agruparReceitaPorPosto(
  linhas: { posto: string; pmo_componente: string }[],
): ReceitaPorPosto {
  const out: ReceitaPorPosto = {}
  for (const l of linhas) {
    const lista = (out[l.posto] ??= [])
    if (!lista.includes(l.pmo_componente)) lista.push(l.pmo_componente)
  }
  return out
}

/** Achata a receita por posto em linhas {posto,pmo} para inserir no banco. */
export function receitaParaLinhas(receita: ReceitaPorPosto): { posto: string; pmo: string }[] {
  const out: { posto: string; pmo: string }[] = []
  for (const posto of Object.keys(receita)) {
    for (const pmo of receita[posto] ?? []) out.push({ posto, pmo })
  }
  return out
}

/** Remove PMOs vazias e duplicadas (case-insensitive), preservando ordem. */
function limparPmos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return []
  const vistos = new Set<string>()
  const out: string[] = []
  for (const item of lista) {
    const v = String(item).trim()
    if (v !== '' && !vistos.has(v.toLowerCase())) {
      vistos.add(v.toLowerCase())
      out.push(v)
    }
  }
  return out
}

/**
 * Lê a receita por posto vinda do form (JSON objeto posto→PMOs), mantendo só os postos
 * informados como de Integração e limpando PMOs vazias/duplicadas por posto.
 */
export function parseReceitaPorPosto(json: string, postosIntegracao: string[]): ReceitaPorPosto {
  let bruto: unknown
  try {
    bruto = JSON.parse(json)
  } catch {
    return {}
  }
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) return {}
  const permitido = new Set(postosIntegracao)
  const out: ReceitaPorPosto = {}
  for (const [posto, lista] of Object.entries(bruto as Record<string, unknown>)) {
    if (!permitido.has(posto)) continue
    const pmos = limparPmos(lista)
    if (pmos.length > 0) out[posto] = pmos
  }
  return out
}

/** Aceita a receita de um padrão em objeto (novo) ou array legado (vira receita do posto 'Integração'). */
export function coagirReceitaPadrao(bruto: unknown): ReceitaPorPosto {
  if (Array.isArray(bruto)) {
    const pmos = limparPmos(bruto)
    return pmos.length > 0 ? { 'Integração': pmos } : {}
  }
  if (typeof bruto === 'object' && bruto !== null) {
    const out: ReceitaPorPosto = {}
    for (const [posto, lista] of Object.entries(bruto as Record<string, unknown>)) {
      const pmos = limparPmos(lista)
      if (pmos.length > 0) out[posto] = pmos
    }
    return out
  }
  return {}
}
