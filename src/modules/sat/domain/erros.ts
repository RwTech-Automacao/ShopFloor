/** Os códigos que as funções da 0186 levantam, na língua da tela. O resto vira a mensagem genérica. */
const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  NS_OBRIGATORIO: 'Informe o número de série.',
  NF_OBRIGATORIA: 'Informe a NF.',
  SITUACAO_INVALIDA: 'Situação da NF inválida.',
  MOTIVO_OBRIGATORIO: 'NF reprovada: escolha ao menos um motivo.',
  MOTIVO_EM_NF_APROVADA: 'NF aprovada não leva motivo de reprovação.',
  MOTIVO_INVALIDO: 'Um dos motivos não existe mais ou foi desativado. Recarregue a página.',
  OUTROS_SEM_TEXTO: 'Descreva os outros itens que vieram junto.',
  OS_NAO_ENCONTRADA: 'A OS escolhida não existe mais. Busque o número de série de novo.',
  ENTRADA_NAO_ENCONTRADA: 'Entrada não encontrada.',
  NADA_A_MUDAR: 'A NF já está assim — nada a mudar.',
  MESMA_NF: 'A NF nova é igual à atual — para mudar só a situação, use Corrigir.',
  TEXTO_INVALIDO: 'O motivo precisa de um texto (até 200 caracteres).',
  MOTIVO_NAO_ENCONTRADO: 'Motivo não encontrado.',
}

export function mensagemDoErro(mensagemDoBanco: string, generica = 'Não foi possível concluir. Tente de novo.'): string {
  const m = (mensagemDoBanco ?? '').trim()
  if (MENSAGENS[m]) return MENSAGENS[m]
  if (m.includes('sat_motivos_nf_texto')) return 'Já existe um motivo com esse texto.'
  return generica
}
