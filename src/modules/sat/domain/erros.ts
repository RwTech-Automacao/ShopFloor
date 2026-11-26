/** Os códigos que as funções do SAT (0186/0187/0190/0198) levantam, na língua da tela. O resto vira a mensagem genérica. */
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
  OUTRO_SEM_TEXTO: 'Descreva o outro motivo.',
  OUTRO_TEXTO_LONGO: 'O outro motivo passa de 200 caracteres.',
  NF_NAO_ENCONTRADA: 'Nota não encontrada.',
  ENTRADA_NAO_ENCONTRADA: 'Entrada não encontrada.',
  NADA_A_MUDAR: 'Já está assim — nada a mudar.',
  MESMA_NF: 'A nota nova é igual à atual — para mudar só a situação, use Corrigir.',
  OS_NAO_ENCONTRADA: 'A OS escolhida não existe mais. Recarregue a página.',
  OS_DE_OUTRO_NS: 'Essa OS não é deste número de série.',
  OS_EM_USO: 'Essa OS já está ligada a outro relógio.',
  // ordem de serviço (0198)
  ORDEM_NAO_ENCONTRADA: 'Ordem de serviço não encontrada. Recarregue a página.',
  ETAPA_NAO_PERMITE: 'A OS não está na etapa certa para isso. Recarregue a página.',
  ETAPA_INVALIDA: 'Etapa inválida.',
  DEFEITO_INVALIDO: 'Esse defeito não existe mais ou foi desativado. Recarregue a página.',
  DEFEITO_REPETIDO: 'Esse defeito já está nesta OS.',
  SOLUCAO_OBRIGATORIA: 'Descreva a solução do defeito.',
  TEXTO_LONGO: 'Texto longo demais.',
  CODIGO_INVALIDO: 'Código do item inválido.',
  QUANTIDADE_INVALIDA: 'Quantidade inválida (maior que zero, até 9999).',
  PECA_REPETIDA: 'Essa peça já está nesta OS — remova e lance de novo com a quantidade certa.',
  ITEM_NAO_ENCONTRADO: 'Esse lançamento não existe mais. Recarregue a página.',
  SEM_DEFEITO: 'Lance ao menos um defeito antes de enviar para a qualidade.',
  SEM_LAUDO: 'Escreva o laudo antes de enviar para a qualidade.',
  GARANTIA_INDEFINIDA: 'A planilha não diz se esta OS é garantia. Confira o ticket do suporte.',
  MOTIVO_CORRECAO_OBRIGATORIO: 'Escreva o motivo da correção (3 a 500 caracteres).',
  CHAVE_INVALIDA: 'Não foi possível guardar a leitura do Compels.',
  CACHE_GRANDE: 'Não foi possível guardar a leitura do Compels.',
}))

export function mensagemDoErro(mensagemDoBanco: string, generica = 'Não foi possível concluir. Tente de novo.'): string {
  const m = (mensagemDoBanco ?? '').trim()
  return MENSAGENS.get(m) ?? generica
}
