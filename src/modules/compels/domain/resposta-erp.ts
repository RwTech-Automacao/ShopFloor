/**
 * Interpreta a resposta de um gesto que GRAVA no Compels (empenhar, requisitar, apontar, estornar).
 *
 * Formatos vistos em 16/10/2026:
 * - sucesso do Empenhar: 200 `{ message: "Empenho realizado com sucesso!", result: null }`
 * - sucesso dos demais: 200 `{ success: true, msg: "<center><font ...>Apontamento de Nº 1 ... com sucesso!</font></center>" }`
 *   (a `msg` vem com HTML)
 * - erro: **HTTP 400** `{ code, message, detail, hint, cause }`, com `message` já em português e,
 *   às vezes, HTML e e-mail de quem segura a OP.
 *   Ex.: "Este registro está sendo acessado pelo usuário <b>...</b>!" (OP travada) e
 *   "Quantidade Empenhada é maior que a Quantidade da Composição. Item: RWPC99".
 */
export type CodigoErroErp =
  | 'op_em_uso'
  | 'quantidade_acima'
  | 'sem_saldo'
  | 'sessao_expirada'
  | 'sem_permissao'
  | 'indisponivel'
  | 'desconhecido'

export type ResultadoGravacao =
  | { ok: true; mensagem: string }
  | { ok: false; codigo: CodigoErroErp; mensagem: string; tentarDeNovo: boolean }

/** Tira as tags HTML e junta os espaços: a tela de pendências mostra texto simples. */
export function textoLimpo(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function mensagemDe(corpo: unknown): string {
  if (typeof corpo !== 'object' || corpo === null) return ''
  const o = corpo as Record<string, unknown>
  for (const campo of ['message', 'msg']) {
    if (typeof o[campo] === 'string' && o[campo].trim() !== '') return textoLimpo(o[campo] as string)
  }
  return ''
}

function classificar(status: number, mensagem: string): { codigo: CodigoErroErp; tentarDeNovo: boolean } {
  if (status === 401) return { codigo: 'sessao_expirada', tentarDeNovo: true }
  if (status === 403) return { codigo: 'sem_permissao', tentarDeNovo: false }
  if (status >= 500) return { codigo: 'indisponivel', tentarDeNovo: true }
  if (/est[aá] sendo acessado pelo usu[aá]rio/i.test(mensagem)) return { codigo: 'op_em_uso', tentarDeNovo: true }
  if (/maior que a quantidade|excede/i.test(mensagem)) return { codigo: 'quantidade_acima', tentarDeNovo: false }
  if (/saldo/i.test(mensagem)) return { codigo: 'sem_saldo', tentarDeNovo: true }
  return { codigo: 'desconhecido', tentarDeNovo: false }
}

export function resultadoDaGravacao(status: number, corpo: unknown): ResultadoGravacao {
  const mensagem = mensagemDe(corpo)
  const o = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {}

  const recusadoNoCorpo = o.success === false
  if (status >= 200 && status < 300 && !recusadoNoCorpo) {
    return { ok: true, mensagem }
  }

  // Sem mensagem do ERP, mostra o código HTTP em vez de um texto inventado.
  return {
    ok: false,
    ...classificar(status, mensagem),
    mensagem: mensagem || `O Compels recusou a gravação (HTTP ${status}).`,
  }
}
