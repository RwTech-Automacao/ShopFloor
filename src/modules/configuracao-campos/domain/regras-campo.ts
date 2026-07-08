export type TipoCampo = 'texto' | 'lista' | 'numero' | 'data'

export type ResultadoValidacaoTipoCampo =
  | { ok: true; tipo: TipoCampo }
  | { ok: false; erro: string }

/**
 * Regras de negócio para a edição de tipo/lista_chave de um campo:
 *
 * - Campos cujo tipo atual é `numero` ou `data` têm o tipo fixo — qualquer
 *   valor submetido para `tipo` é ignorado e o tipo atual é preservado.
 *   Isso impede que o formulário (mesmo adulterado) transforme um campo
 *   numérico/data em texto ou lista.
 * - Se o tipo resultante for `lista`, uma `lista_chave` é obrigatória.
 */
export function validarTipoCampo(input: {
  tipoAtual: TipoCampo
  tipoSubmetido: TipoCampo
  listaChave: string | null
}): ResultadoValidacaoTipoCampo {
  const tipoAtualFixo = input.tipoAtual === 'numero' || input.tipoAtual === 'data'
  const tipo = tipoAtualFixo ? input.tipoAtual : input.tipoSubmetido

  if (tipo === 'lista' && !input.listaChave) {
    return { ok: false, erro: 'Selecione uma lista para campos do tipo lista.' }
  }

  return { ok: true, tipo }
}
