/**
 * Blindagem contra o "clique fantasma" do toque.
 *
 * Em telas de toque, o navegador não dispara `click` no exato instante em que o dedo sai
 * da tela: ele sintetiza esse evento alguns milissegundos depois e refaz a conta de qual
 * elemento está naquele ponto. Isso é inofensivo na maioria das vezes, mas quebra quando
 * uma camada (como a lista de um `Select`) cobre um elemento clicável e some assim que o
 * item é escolhido — o clique sintetizado chega depois, encontra o que ficou exposto
 * embaixo (um campo de arquivo, um botão) e aciona também. Um gesto, dois efeitos.
 *
 * A correção não mexe em layout nem em geometria: ela engole **um** clique perdido logo
 * após o fechamento da camada, só em ponteiro grosso (toque), sem tocar em cliques que
 * aconteçam dentro da própria camada ou do campo que a abre — esses são legítimos.
 *
 * Ver design completo em
 * `docs/superpowers/specs/2026-09-23-clique-fantasma-select-touch-design.md`.
 */

/** Cliques dentro desses elementos são legítimos e nunca são engolidos. */
const SELETOR_CLIQUE_LEGITIMO = '[data-slot="select-content"], [data-slot="select-trigger"]'

/** Só existe clique fantasma em ponteiro de toque; com mouse não há `click` sintetizado. */
function temPonteiroGrosso(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Arma, por `janelaMs` milissegundos, um filtro que cancela o primeiro clique fora da
 * lista/campo que a abre. Chamar quando uma lista de seleção fecha.
 *
 * Não faz nada em ponteiro fino (mouse/trackpad) — lá o comportamento de hoje continua
 * idêntico. A proteção some sozinha ao fim da janela, mesmo que nenhum clique chegue, e se
 * desarma depois do primeiro clique cancelado, mesmo que ainda dentro da janela.
 */
export function blindarCliqueFantasma(janelaMs = 350): void {
  if (!temPonteiroGrosso()) return

  const desarmar = () => {
    document.removeEventListener('click', cancelarClique, true)
    clearTimeout(temporizador)
  }

  const cancelarClique = (evento: MouseEvent) => {
    const alvo = evento.target
    if (alvo instanceof Element && alvo.closest(SELETOR_CLIQUE_LEGITIMO)) return

    evento.preventDefault()
    evento.stopPropagation()
    desarmar()
  }

  // `temporizador` só é lido dentro de `desarmar`, chamada depois desta linha (no clique
  // ou no fim da janela) — a referência acima ao closure é segura mesmo antes da atribuição.
  const temporizador = setTimeout(desarmar, janelaMs)
  document.addEventListener('click', cancelarClique, true)
}
