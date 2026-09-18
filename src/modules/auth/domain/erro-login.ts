/**
 * Mensagem do login a partir do erro do Supabase Auth.
 *
 * Fora do horário o RDS fica desligado (plano de economia): o GoTrue responde 5xx ou nem responde.
 * Antes disso virava "Usuário ou senha inválidos" e a pessoa achava que tinha errado a senha.
 */
export interface ErroAuth {
  status?: number
  code?: string
  name?: string
}

export const MSG_CREDENCIAL_INVALIDA = 'Usuário ou senha inválidos.'
export const MSG_MUITAS_TENTATIVAS = 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.'
export const MSG_SISTEMA_FORA =
  'O sistema está fora do ar agora. Ele funciona de segunda a sábado, das 06:00 às 19:00. ' +
  'Fora desse horário, ou se o problema continuar, avise o TI.'

export function mensagemErroLogin(erro: ErroAuth): string {
  const status = erro.status ?? 0
  // Sem resposta (rede/servidor caído) ou erro do servidor: não é culpa da senha.
  if (erro.name === 'AuthRetryableFetchError' || status === 0 || status >= 500) return MSG_SISTEMA_FORA
  if (status === 429 || erro.code === 'over_request_rate_limit') return MSG_MUITAS_TENTATIVAS
  return MSG_CREDENCIAL_INVALIDA
}
