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

/** Inverso do `marcadorCaixaAberta`: 'CX[3]' → 3. Null quando não é um marcador de caixa aberta
 *  (código final de caixa fechada, SN da embalagem individual, vazio). */
export function seqDoMarcadorCaixa(numeroCaixa: string): number | null {
  const m = /^CX\[(\d+)\]$/.exec(numeroCaixa.trim())
  return m ? Number(m[1]) : null
}

/**
 * Caixas REABERTAS por cancelamento: vigentes (revisao 0), abertas, que não são a caixa da vez.
 *
 * Reaberta e REMONTAGEM são coisas diferentes (decisão de 14/09/2026), e esta função existe pra não
 * misturar as duas:
 *  • remontagem = o seq tem uma montagem APOSENTADA (revisao > 0): a caixa foi reprovada no NQA e
 *    está sendo refeita. Tem painel próprio ("Aguardando remontagem") e não entra aqui;
 *  • reaberta   = um bipe de uma caixa já FECHADA foi cancelado (0106) e ela voltou a ficar aberta,
 *    lá atrás, enquanto a embalagem segue na caixa da vez.
 *
 * Uma remontagem que depois teve um bipe cancelado continua sendo remontagem: o que define é a
 * montagem aposentada, que continua existindo.
 */
export function seqsReabertas(
  caixas: readonly { seq: number; fechada: boolean; revisao: number }[],
  seqDaVez: number,
): number[] {
  const comMontagemAposentada = new Set(caixas.filter((c) => c.revisao > 0).map((c) => c.seq))
  return caixas
    .filter((c) => c.revisao === 0 && !c.fechada && c.seq !== seqDaVez && !comMontagemAposentada.has(c.seq))
    .map((c) => c.seq)
    .sort((a, b) => a - b)
}
