/** Validação pra salvar um Padrão de Fluxo. */
export function validarPadraoFluxo(
  nome: string,
  postos: string[],
): { ok: true } | { ok: false; erro: string } {
  if (nome.trim() === '') return { ok: false, erro: 'Informe o nome do padrão.' }
  if (postos.length === 0) {
    return { ok: false, erro: 'Adicione ao menos um posto ao fluxo antes de salvar como padrão.' }
  }
  return { ok: true }
}
