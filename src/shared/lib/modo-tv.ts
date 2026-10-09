/**
 * Modo TV do Fluxo da OP: o que é puro (sem React, sem DOM) fica aqui pra ser testado.
 *
 * "Modo TV" tem DUAS formas de ligar, e o resto da tela não distingue:
 *   - pela API de tela cheia do navegador (botão "Modo TV" da tela normal) — `telaCheiaApi`;
 *   - pela prop `modoTv` (embed no Dashboard, `?modo=tv`), SEM API nenhuma: a tela cheia é do
 *     Dashboard, e o Fluxo disputar o recurso derrubava a do Dashboard junto.
 */

/** `?modo=tv` liga; qualquer outra coisa (ausente, vazio, "TV", "1") não. Repetido: vale o primeiro. */
export function lerModoTv(valor: string | string[] | undefined): boolean {
  const primeiro = Array.isArray(valor) ? valor[0] : valor
  return primeiro === 'tv'
}

/**
 * Os três controles de operação (Filtro, Zoom, Defeitos) só aparecem no hover quando a tela está
 * NO EMBED (com ou sem `?modo=tv`) OU em Modo TV (prop `modoTv` ou tela cheia do navegador).
 *
 * ⚠️ Só a tela normal fora do Modo TV mantém os três sempre visíveis: o Fluxo é usado em TABLET
 * pelos supervisores, e tablet não tem hover — esconder lá deixaria os três inalcançáveis. Este é
 * o ÚNICO ponto da decisão (usuário, 09/10: o embed esconde SEMPRE, não só em apresentação).
 */
export function controlesSoNoHover(emEmbed: boolean, emModoTv: boolean): boolean {
  return emEmbed || emModoTv
}

/**
 * Esconde sem tirar do layout. O hover é do CANVAS inteiro (`group/canvas`), não do botão —
 * senão ninguém acharia um botão invisível. `pointer-events-none` evita clique acidental no
 * invisível; `focus-within` mantém o teclado alcançando.
 */
export const CLASSE_SO_NO_HOVER =
  'opacity-0 pointer-events-none transition-opacity duration-200 ' +
  'group-hover/canvas:opacity-100 group-hover/canvas:pointer-events-auto ' +
  'focus-within:opacity-100 focus-within:pointer-events-auto'

export function classeSoNoHover(ativo: boolean): string {
  return ativo ? CLASSE_SO_NO_HOVER : ''
}
