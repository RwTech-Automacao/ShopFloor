/**
 * As funções do banco sinalizam regra de negócio com `raise exception 'CODIGO'`. O client do
 * Supabase entrega isso em `error.message`, às vezes com prefixo. Aqui a gente extrai o código e
 * traduz — a tela e o bot nunca mostram texto de Postgres.
 */
const MENSAGENS: Record<string, string> = {
  CODIGO_INVALIDO: 'Código inválido ou já usado. Gere um novo em Meu perfil.',
  CANAL_INVALIDO: 'Canal inválido.',
  CONTA_JA_VINCULADA: 'Esta conta já está vinculada a outro usuário do ShopFloor.',
  MUITAS_TENTATIVAS: 'Muitas tentativas. Aguarde 15 minutos e gere um código novo no ShopFloor.',
  NAO_DESTINATARIO: 'Você não é responsável por esta regra ou não administra o ShopFloor.',
  OCORRENCIA_ENCERRADA: 'Esta ocorrência já normalizou.',
  OCORRENCIA_INEXISTENTE: 'Ocorrência não encontrada.',
  SEM_PERMISSAO: 'Você não tem permissão para configurar alertas.',
  SEM_USUARIO: 'Sessão inválida. Entre de novo no sistema.',
  JANELA_INVALIDA: 'Informe um valor de janela maior que zero.',
  TIPO_FIXO: 'O tipo da regra não muda depois de criado.',
  TIPO_INVALIDO: 'Escolha o tipo da regra.',
  PAUSA_INVALIDA: 'Ignorar pausas acima de: informe um número inteiro de 1 a 240 minutos.',
  LIMITE_INVALIDO: 'Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).',
}

const GENERICA = 'Não foi possível concluir agora. Tente de novo.'

export function codigoErroAlerta(mensagem: string | null | undefined): string {
  const texto = mensagem ?? ''
  for (const codigo of Object.keys(MENSAGENS)) {
    if (texto.includes(codigo)) return codigo
  }
  return ''
}

export function mensagemErroAlerta(mensagem: string | null | undefined): string {
  const codigo = codigoErroAlerta(mensagem)
  return codigo ? MENSAGENS[codigo]! : GENERICA
}
