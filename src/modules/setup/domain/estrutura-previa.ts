import type { Processo } from './tipos'

export interface ItemEstrutura { componente: string; processo: Processo }
export interface PreviaEstrutura {
  novos: ItemEstrutura[]
  iguais: ItemEstrutura[]
  processoAlterado: (ItemEstrutura & { processoAtual: Processo })[]
  ausentesNoArquivo: ItemEstrutura[]
}

/** Prévia da importação: o que entra, o que muda de processo e o que ficou só no cadastro (não é apagado). */
export function compararEstrutura(atual: ItemEstrutura[], arquivo: ItemEstrutura[]): PreviaEstrutura {
  const porCodigo = new Map(atual.map((a) => [a.componente, a]))
  const noArquivo = new Set(arquivo.map((a) => a.componente))
  const previa: PreviaEstrutura = { novos: [], iguais: [], processoAlterado: [], ausentesNoArquivo: [] }
  for (const item of arquivo) {
    const existente = porCodigo.get(item.componente)
    if (!existente) previa.novos.push({ componente: item.componente, processo: item.processo })
    else if (existente.processo === item.processo) previa.iguais.push({ componente: item.componente, processo: item.processo })
    else previa.processoAlterado.push({ componente: item.componente, processo: item.processo, processoAtual: existente.processo })
  }
  for (const a of atual) if (!noArquivo.has(a.componente)) previa.ausentesNoArquivo.push({ componente: a.componente, processo: a.processo })
  return previa
}
