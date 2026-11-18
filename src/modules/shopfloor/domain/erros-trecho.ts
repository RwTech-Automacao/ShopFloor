/**
 * Erros das funções de trecho do banco (0184: sf_cadastrar_op e as sf_ordem_regravar_*) em PT-BR. Um lugar só, para
 * o cadastro e a edição de OP falarem igual. Fora desses códigos: null (quem chama decide a mensagem genérica).
 */
export function mensagemErroDeTrecho(e: unknown): string | null {
  const msg = String((e as { message?: unknown } | null)?.message ?? '')
  if (msg === 'SEM_TRECHO') return 'A OP precisa de pelo menos um trecho.'
  if (msg === 'TRECHO_SEQ_REPETIDO') return 'Dois trechos estão com o mesmo número de ordem.'
  if (msg === 'PMO_NAO_E_ULTIMO') return 'A OP da PMO tem que ser o último trecho.'
  const m = /^(TRECHO_SEM_POSTO|POSTO_REPETIDO|TRECHO_SEM_FAIXA):(.+)$/.exec(msg)
  if (m?.[1] === 'TRECHO_SEM_POSTO') return `O trecho ${m[2]} ficaria sem posto.`
  if (m?.[1] === 'POSTO_REPETIDO') return `O posto "${m[2]}" está em mais de um trecho.`
  if (m?.[1] === 'TRECHO_SEM_FAIXA') return `O trecho ${m[2]} ficaria sem faixa de SN.`
  return null
}
