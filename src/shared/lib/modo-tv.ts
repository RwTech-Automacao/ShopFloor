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
 * Esconde sem tirar do layout. O hover é de CADA CONTROLE, não do canvas.
 *
 * ⚠️ Já foi do canvas inteiro (`group/canvas`) e estava errado: em Modo TV o canvas é a tela toda,
 * então bastava o mouse estar em qualquer lugar da página para os três reaparecerem — na prática
 * eles ficavam sempre visíveis, que é o oposto do pedido. Visto em produção pelo usuário em 09/10.
 * Agora só aparece o controle para onde o mouse FOI.
 *
 * Como um elemento `pointer-events-none` não recebe hover, o controle invisível precisa continuar
 * recebendo o ponteiro — mas só onde existe ponteiro: `[@media(hover:hover)]` liga os eventos no
 * PC e na TV e os deixa desligados no toque. É o que impede o tablet de esbarrar num botão
 * invisível (em Modo TV os três são inalcançáveis no tablet, e isso está aceito na spec).
 * `focus-within` mantém o teclado alcançando.
 */
export const CLASSE_SO_NO_HOVER =
  'opacity-0 pointer-events-none transition-opacity duration-200 ' +
  '[@media(hover:hover)]:pointer-events-auto ' +
  'hover:opacity-100 focus-within:opacity-100 focus-within:pointer-events-auto'

export function classeSoNoHover(ativo: boolean): string {
  return ativo ? CLASSE_SO_NO_HOVER : ''
}
