export function validarAcaoUsuario(input: {
  usuarioAlvoId: string
  usuarioLogadoId: string
  novoAtivo: boolean
  perfilAlvoTemAdministrar: boolean
}): { ok: true } | { ok: false; erro: string } {
  const ehProprio = input.usuarioAlvoId === input.usuarioLogadoId
  if (ehProprio && !input.novoAtivo) {
    return { ok: false, erro: 'Você não pode desativar a si mesmo.' }
  }
  if (ehProprio && !input.perfilAlvoTemAdministrar) {
    return { ok: false, erro: 'Você não pode remover seu próprio acesso de Administrador.' }
  }
  return { ok: true }
}
