/**
 * Etapa 2 do card único: o posto Almoxarifado entra sozinho como ÚLTIMO da rota de OP NOVA.
 * Nasce DESLIGADA: só liga com a variável de servidor ALMOXARIFADO_AUTOMATICO_NAS_OPS_NOVAS = "1".
 * Tudo aqui é puro; quem lê o ambiente e grava é a action de criar OP (nunca a de editar).
 */

export const MSG_VARIOS_ALMOXARIFADOS = 'Há mais de um posto com perfil Almoxarifado; mantenha só um.'

/** Interruptor: ligado só se o valor for exatamente "1". Ausente/qualquer outra coisa = desligado. */
export function almoxarifadoAutomaticoLigado(valor: string | undefined): boolean {
  return valor === '1'
}

/**
 * A chave do ÚNICO posto com perfil de recurso `almoxarifado` (decide o perfil, nunca o nome), ou
 * `null` se não existe, ou erro se houver mais de um.
 */
export function postoAlmoxarifadoDaOp(
  postosPerfil: Record<string, { recurso: string }>,
): { ok: true; posto: string | null } | { ok: false; erro: 'VARIOS_ALMOXARIFADOS' } {
  const chaves = Object.keys(postosPerfil).filter((k) => postosPerfil[k]?.recurso === 'almoxarifado')
  if (chaves.length > 1) return { ok: false, erro: 'VARIOS_ALMOXARIFADOS' }
  return { ok: true, posto: chaves[0] ?? null }
}

/** Acrescenta o Almoxarifado como último da rota. Já presente (ou sem posto) = rota intacta. */
export function rotaComAlmoxarifadoNoFim(postos: string[], almoxarifado: string | null): string[] {
  if (almoxarifado == null || postos.includes(almoxarifado)) return postos
  return [...postos, almoxarifado]
}
