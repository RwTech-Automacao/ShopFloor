/**
 * Código final da caixa: CX[seq][qtd]OP-PMO (colchetes literais). Ex.: CX[3][10]12345-PMO973.
 * ATENÇÃO: em runtime, quem GERA o código é o RPC `sf_fechar_caixa` (fonte canônica) — esta
 * função documenta/testa o formato; se mudar o formato, mude nos DOIS lugares.
 */
export function gerarCodigoCaixa(seq: number, qtd: number, op: string, pmo: string): string {
  return `CX[${seq}][${qtd}]${op}-${pmo}`
}

/** Marcador da caixa ABERTA (antes de fechar), gravado no numero_caixa dos registros: CX[seq]. */
export function marcadorCaixaAberta(seq: number): string {
  return `CX[${seq}]`
}

/**
 * Quantas peças foram embaladas ANTES desta caixa, no mesmo posto. É a base do contador "QTD" da
 * folha impressa: a lista da caixa 6 começa em 61 porque as cinco caixas anteriores somaram 60.
 * A contagem é só sequencial (ordem de embalagem), sem amarração com faixa de SN ou índice da OP.
 * Escopo = o posto: dois postos de embalagem contam separado, como as caixas já são numeradas.
 */
export function pecasAntesDaCaixa(
  caixas: readonly { posto: string; seq: number; qtd: number }[],
  alvo: { posto: string; seq: number },
): number {
  return caixas
    .filter((c) => c.posto === alvo.posto && c.seq < alvo.seq)
    .reduce((soma, c) => soma + c.qtd, 0)
}
