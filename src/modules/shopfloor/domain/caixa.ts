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

/**
 * Código da montagem APOSENTADA — a que foi reprovada no NQA e vai ser refeita com o mesmo número.
 * O `R` entra logo depois do `CX[seq]`, preservando o resto do código: CX[7][14]8498-PMOC14 vira
 * CX[7]R[14]8498-PMOC14. Da 2ª reprova em diante o número da revisão entra junto (R2, R3…) pra não
 * colidir com a anterior.
 *
 * ATENÇÃO: em runtime quem renomeia é o RPC `sf_aposentar_caixa` (fonte canônica) — esta função
 * documenta/testa o formato; se mudar, mude nos DOIS lugares.
 */
export function codigoMontagemAposentada(codigo: string, seq: number, revisao: number): string {
  const prefixo = marcadorCaixaAberta(seq)
  if (!codigo.startsWith(prefixo)) return codigo
  const marca = revisao <= 1 ? 'R' : `R${revisao}`
  return prefixo + marca + codigo.slice(prefixo.length)
}
