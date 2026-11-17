/** Os códigos que as funções do SAT (0186/0187) levantam, na língua da tela. O resto vira a mensagem genérica. */
const MENSAGENS = new Map<string, string>(Object.entries({
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  ENTRADA_INVALIDA: 'Entrada inválida. Recarregue a página e tente de novo.',
  CNPJ_INVALIDO: 'CNPJ da nota inválido (14 dígitos) ou CPF (11).',
  NF_OBRIGATORIA: 'Informe o número da NF.',
  SEM_RELOGIOS: 'Bipe ao menos um relógio.',
  RELOGIOS_DEMAIS: 'Uma nota leva no máximo 200 relógios.',
  NS_OBRIGATORIO: 'Informe o número de série.',
  NS_REPETIDO: 'Um número de série está duas vezes nesta nota.',
  ITEM_INVALIDO: 'Item que veio junto inválido.',
  SITUACAO_INVALIDA: 'Situação da NF inválida.',
  MOTIVO_OBRIGATORIO: 'NF reprovada: escolha ao menos um motivo.',
  MOTIVO_EM_NF_APROVADA: 'NF aprovada não leva motivo de reprovação.',
  MOTIVO_INVALIDO: 'Um dos motivos não existe mais ou foi desativado. Recarregue a página.',
  OUTROS_SEM_TEXTO: 'Descreva os outros itens que vieram junto.',
  NF_NAO_ENCONTRADA: 'Nota não encontrada.',
  ENTRADA_NAO_ENCONTRADA: 'Entrada não encontrada.',
  NADA_A_MUDAR: 'Já está assim — nada a mudar.',
  MESMA_NF: 'A nota nova é igual à atual — para mudar só a situação, use Corrigir.',
  OS_NAO_ENCONTRADA: 'A OS escolhida não existe mais. Recarregue a página.',
  OS_DE_OUTRO_NS: 'Essa OS não é deste número de série.',
  OS_EM_USO: 'Essa OS já está ligada a outro relógio.',
}))

export function mensagemDoErro(mensagemDoBanco: string, generica = 'Não foi possível concluir. Tente de novo.'): string {
  const m = (mensagemDoBanco ?? '').trim()
  return MENSAGENS.get(m) ?? generica
}
