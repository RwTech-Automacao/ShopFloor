import { listaDe, RespostaInesperada } from './leituras-erp'

/**
 * Saldo de um item POR ESTOQUE, lido de `GET /estoque/consultaSaldoItemEstoque` (tela Movimento de Item, linha
 * expandida; capturado em 11/11/2026). Resposta: `{ results: [{ item, estoque: { codigo, descricao }, saldo }],
 * metadata }`, uma linha por estoque que tem saldo (com `exibeItensComSaldoZerado=false`, item sem saldo
 * nenhum volta com `results` vazio).
 */
export interface SaldoEmEstoque {
  /** Código do estoque no Compels (ex.: `PA`, `EINTER`). */
  estoque: string
  descricao: string
  saldo: number
}

/** Estoques que contam como "disponível" no card Finalizadas: produto acabado + intermediário (pedido de 11/11/2026). */
export const ESTOQUES_DISPONIVEIS = ['PA', 'EINTER'] as const

/** Linhas do item pedido (código EXATO, sem diferenciar maiúsculas: a busca do Compels não é exata). */
export function saldosPorEstoque(resposta: unknown, codigo: string): SaldoEmEstoque[] {
  const alvo = codigo.trim().toUpperCase()
  const saida: SaldoEmEstoque[] = []
  for (const linha of listaDe(resposta, 'saldo por estoque')) {
    const item = linha.item as Record<string, unknown> | null | undefined
    if (typeof item?.codigo !== 'string') throw new RespostaInesperada('saldoEstoque.item.codigo')
    if (item.codigo.trim().toUpperCase() !== alvo) continue
    const estoque = linha.estoque as Record<string, unknown> | null | undefined
    if (typeof estoque?.codigo !== 'string') throw new RespostaInesperada('saldoEstoque.estoque.codigo')
    if (typeof linha.saldo !== 'number' || !Number.isFinite(linha.saldo)) throw new RespostaInesperada('saldoEstoque.saldo')
    saida.push({
      estoque: estoque.codigo.trim(),
      descricao: typeof estoque.descricao === 'string' ? estoque.descricao.trim() : '',
      saldo: linha.saldo,
    })
  }
  return saida
}

/** Soma só os estoques aceitos; devolve também a quebra (um por estoque aceito, zero quando não veio). */
export function saldoDisponivel(
  linhas: readonly SaldoEmEstoque[],
  aceitos: readonly string[] = ESTOQUES_DISPONIVEIS,
): { total: number; porEstoque: { estoque: string; saldo: number }[] } {
  const porEstoque = aceitos.map((e) => ({
    estoque: e,
    saldo: linhas.filter((l) => l.estoque.toUpperCase() === e.toUpperCase()).reduce((s, l) => s + l.saldo, 0),
  }))
  return { total: porEstoque.reduce((s, p) => s + p.saldo, 0), porEstoque }
}
