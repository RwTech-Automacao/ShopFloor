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
 * - Campos editáveis (tipo atual `texto`/`lista`) só podem alternar entre
 *   `texto` e `lista`. Promover para `numero`/`data` é rejeitado (esses tipos
 *   são estruturais/seed-only, ligados ao tipo real da coluna no banco).
 * - Se o tipo resultante for `lista`, uma `lista_chave` é obrigatória.
 */
export function validarTipoCampo(input: {
  tipoAtual: TipoCampo
  tipoSubmetido: TipoCampo
  listaChave: string | null
}): ResultadoValidacaoTipoCampo {
  const tipoAtualFixo = input.tipoAtual === 'numero' || input.tipoAtual === 'data'

  if (!tipoAtualFixo && input.tipoSubmetido !== 'texto' && input.tipoSubmetido !== 'lista') {
    return {
      ok: false,
      erro: 'Um campo editável só pode ser do tipo Texto ou Lista.',
    }
  }

  const tipo = tipoAtualFixo ? input.tipoAtual : input.tipoSubmetido

  if (tipo === 'lista' && !input.listaChave) {
    return { ok: false, erro: 'Selecione uma lista para campos do tipo lista.' }
  }

  return { ok: true, tipo }
}
