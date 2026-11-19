/**
 * Erros das funções de trecho do banco (0184: sf_cadastrar_op e as sf_ordem_regravar_*) em PT-BR. Um lugar só, para
 * o cadastro e a edição de OP falarem igual. Fora desses códigos: null (quem chama decide a mensagem genérica).
 */
export function mensagemErroDeTrecho(e: unknown): string | null {
  const msg = String((e as { message?: unknown } | null)?.message ?? '')
  if (msg === 'SEM_TRECHO') return 'A OP precisa de pelo menos um trecho.'
  if (msg === 'TRECHO_SEQ_REPETIDO') return 'Dois trechos estão com o mesmo número de ordem.'
  if (msg === 'PMO_NAO_E_ULTIMO') return 'A OP da PMO tem que ser o último trecho.'
  // 0194 (sf_ordem_regravar_trechos)
  if (msg === 'TRECHOS_DIFERENTES') return 'Os trechos da tela não batem com os da OP. Recarregue a página e tente de novo.'
  if (msg === 'OP_SEM_TRECHOS') return 'Esta OP não tem trechos do Compels.'
  if (msg === 'OP_INEXISTENTE') return 'OP não encontrada.'
  if (msg === 'ALMOXARIFADO_FORA_DO_FIM') return 'O Almoxarifado tem que ser o último posto do trecho da PMO.'
  const m = /^(TRECHO_SEM_POSTO|POSTO_REPETIDO|TRECHO_SEM_FAIXA|SN_MODO_INVALIDO|FAIXA_INVALIDA|FAIXA_SOBREPOSTA|POSTO_COM_REGISTROS|PRT_COM_HISTORICO|PRT_FAIXA_COM_HISTORICO):(.+)$/.exec(msg)
  if (m?.[1] === 'TRECHO_SEM_POSTO') return `O trecho ${m[2]} ficaria sem posto.`
  if (m?.[1] === 'POSTO_REPETIDO') return `O posto "${m[2]}" está em mais de um trecho.`
  if (m?.[1] === 'TRECHO_SEM_FAIXA') return `O trecho ${m[2]} ficaria sem faixa de SN.`
  if (m?.[1] === 'SN_MODO_INVALIDO') return `Série inválida no trecho ${m[2]}.`
  if (m?.[1] === 'FAIXA_INVALIDA') return `Faixa de SN inválida no trecho ${m[2]}: início e fim devem ter o mesmo formato, e o início não pode ser maior que o fim.`
  if (m?.[1] === 'FAIXA_SOBREPOSTA') return `Uma faixa de SN do trecho ${m[2]} se sobrepõe a outra faixa da OP.`
  if (m?.[1] === 'POSTO_COM_REGISTROS') return `O posto "${m[2]}" já tem registros nesta OP e não pode trocar de trecho.`
  if (m?.[1] === 'PRT_COM_HISTORICO') return `${m[2]} já tem peças bipadas ou apontadas no Compels: não dá para trocar o posto final nem a série desse trecho.`
  if (m?.[1] === 'PRT_FAIXA_COM_HISTORICO') return `${m[2]} já tem peças bipadas ou apontadas no Compels: a faixa nova tem que continuar cobrindo os SNs já usados.`
  return null
}
