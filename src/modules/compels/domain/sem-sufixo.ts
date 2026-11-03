/**
 * O Compels só conhece a OP e o produto sem o sufixo de "segunda leva" do ShopFloor: a OP `8682_F` é a
 * OP `8682` lá, e a PMO `PMOF52_F` é o produto `PMOF52`. O sufixo é `_` mais letras no FIM do texto
 * (`_` sozinho também vale: `8504_` é `8504`). Qualquer outro `_` no meio do texto fica como está.
 */
export function semSufixo(texto: string): string {
  return texto.trim().replace(/_[A-Za-z]*$/, '')
}
