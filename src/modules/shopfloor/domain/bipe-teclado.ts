/**
 * O leitor de código de barras "digita" a posição das teclas supondo o layout AMERICANO; o PC do chão está em
 * ABNT2. Os caracteres iguais nos dois layouts (letras, números, `_`, `-`) chegam certos; os COLCHETES não:
 *
 *   QR `[`  → tecla do `[` americano → ABNT2 `´`  (acento agudo, TECLA MORTA: funde com a letra seguinte)
 *   QR `]`  → tecla do `]` americano → ABNT2 `[`
 *
 * Por isso `CX[1][160]8682_F-PMOF52_F` chega como `CX´1[´160[8682_F-PMOF52_F` (visto em 06/11/2026), e num lote
 * `LOTE[a1b2…]` o `´` funde com o `a` e vira `á`. A correção de verdade é configurar o leitor para o teclado
 * Brasil; esta tolerância existe para a confirmação do Almoxarifado funcionar enquanto isso não acontece, com
 * qualquer leitor, e também com um QR "compensado" para o layout americano (que usa `]` e `\` no lugar).
 */

/** O que a tecla morta do acento agudo (ABNT2) produz quando a próxima tecla combina com ela. */
const FUNDIDAS: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ý: 'y', ç: 'c',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ý: 'Y', Ç: 'C',
}

/** Os quatro caracteres que um mesmo colchete pode virar no caminho leitor → teclado. */
const SEPARADORES = /[[\]\\´]/g

/**
 * A forma de comparação: tira as pontas, desfaz as letras que o acento fundiu, põe tudo em maiúsculas e trata
 * `[` `]` `\` `´` como UM marcador só. A POSIÇÃO do marcador continua valendo (`CX|1||160|…` ≠ `CX|11||60|…`),
 * então caixas diferentes não se confundem.
 */
export function canonicoDoBipe(texto: string): string {
  const desfeito = (texto ?? '')
    .trim()
    .replace(/[áéíóúýçÁÉÍÓÚÝÇ]/g, (c) => `´${FUNDIDAS[c]}`)
    .toUpperCase()
  return desfeito.replace(SEPARADORES, '|')
}

/**
 * O código REAL (da lista de caixas esperando) a que um bipe se refere, mesmo com o teclado trocado. Só troca
 * quando UM código da lista bate; bipe que não é de nenhuma caixa (um Nº de série) ou que bate com mais de uma
 * sai como veio, sem espaços nas pontas — a decisão continua sendo do servidor.
 */
export function resolverCodigoBipado(bipe: string, codigos: readonly string[]): string {
  const limpo = (bipe ?? '').trim()
  if (limpo === '') return limpo
  const alvo = canonicoDoBipe(limpo)
  const iguais = codigos.filter((c) => canonicoDoBipe(c) === alvo)
  return iguais.length === 1 ? iguais[0]! : limpo
}
