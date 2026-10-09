// Ordenação dos itens de um setup. Duas ordens, para dois propósitos:
//  - por posição: ler o setup conferindo contra a máquina (Abastecimento, Consultas, e a ordem canônica
//    que o repositório devolve);
//  - mais recente primeiro: conferir o que acabou de bipar (só a tela de Montar).

export interface ItemOrdenavel { posicao: string; feeder: string; criadoEm: string }

const OPCOES = { numeric: true } as const

/** Posição numérica quando dá ("2" antes de "10"), senão texto; empate pelo feeder. */
export function compararPorPosicao(a: Pick<ItemOrdenavel, 'posicao' | 'feeder'>, b: Pick<ItemOrdenavel, 'posicao' | 'feeder'>): number {
  return a.posicao.localeCompare(b.posicao, 'pt-BR', OPCOES) || a.feeder.localeCompare(b.feeder, 'pt-BR', OPCOES)
}

function instante(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Cópia da lista com o item criado mais recentemente primeiro. Conta só criadoEm: editar um item
 * (que muda atualizadoEm) NÃO o move. Empate de criadoEm desempata por posição, para a lista não
 * embaralhar entre duas leituras.
 */
export function maisRecentePrimeiro<T extends ItemOrdenavel>(itens: readonly T[]): T[] {
  return [...itens].sort((a, b) => instante(b.criadoEm) - instante(a.criadoEm) || compararPorPosicao(a, b))
}
