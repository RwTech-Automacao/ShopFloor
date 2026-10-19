/**
 * O que a tela do Fluxo mostra do estoque do Compels abaixo do card "Concluído". Consulta NA HORA (sem
 * cópia no ShopFloor), com cache curto em memória no servidor; o número é o estoque PRÓPRIO do item (PMO)
 * em TODOS os estoques do Compels. Não é "o que esta OP deu entrada": é contexto, não conferência.
 */
export type EstoqueCompels =
  | {
      tipo: 'ok'
      proprio: number
      unidade: string
      pendencia: number
      emTerceiros: number
      deTerceiros: number
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
