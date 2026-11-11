/**
 * O que o card Finalizadas do Fluxo mostra do estoque do Compels. Consulta NA HORA (sem cópia no ShopFloor),
 * com cache curto em memória no servidor. `disponivel` = saldo do item (PMO) só nos estoques PA (produto
 * acabado) + EINTER (intermediário), pedido de 11/11/2026; os outros (ativo, engenharia, devolvidos…) não
 * entram. Não é "o que esta OP deu entrada": é contexto, não conferência.
 */
export type EstoqueCompels =
  | {
      tipo: 'ok'
      disponivel: number
      /** Um por estoque considerado (PA, EINTER), zero quando o item não tem saldo nele. */
      porEstoque: { estoque: string; saldo: number }[]
      consultadoEm: string
    }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'indisponivel' }
  /** Sem o login do Compels neste ambiente: a tela não mostra nada (o recurso não existe aqui). */
  | { tipo: 'nao_configurado' }

/** Quantidade com no máximo 3 casas, sem zeros sobrando, no formato brasileiro. */
export function formatarQuantidade(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}
