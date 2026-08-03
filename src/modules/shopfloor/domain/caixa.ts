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
