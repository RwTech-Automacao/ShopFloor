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

/** Inverso do `marcadorCaixaAberta`: 'CX[3]' → 3. Null quando não é um marcador de caixa aberta
 *  (código final de caixa fechada, SN da embalagem individual, vazio). */
export function seqDoMarcadorCaixa(numeroCaixa: string): number | null {
  const m = /^CX\[(\d+)\]$/.exec(numeroCaixa.trim())
  return m ? Number(m[1]) : null
}

/** Uma linha de sf_caixas, só o que a derivação do estado precisa. */
export interface LinhaCaixa {
  seq: number
  limite: number
  fechada: boolean
  ultima: boolean
}

export interface DerivacaoCaixas {
  seq: number           // caixa atual (aberta ou a próxima a abrir)
  limite: number | null // null = nenhuma caixa ainda (o operador digita o limite)
  atualAberta: boolean  // a caixa atual já existe em sf_caixas (tem peças a contar)
  concluida: boolean    // a última caixa da OP já foi fechada
  reabertas: LinhaCaixa[] // caixas abertas que NÃO são a atual (reabertas por cancelamento)
}

/**
 * Decide qual é a caixa ATUAL (a que está sendo enchida) e quais são as REABERTAS.
 *
 * Até o cancelamento de embalagem existir, valia "uma caixa aberta por vez" e bastava olhar a
 * última linha. Cancelar um bipe de uma caixa já fechada REABRE aquela caixa (0098), então podem
 * existir DUAS ou mais abertas ao mesmo tempo: a que o operador está enchendo (sempre a de maior
 * seq) e as reabertas lá atrás, que não podem tomar o lugar dela.
 *
 * `caixas` precisa vir ordenada por seq crescente.
 */
export function derivarEstadoCaixas(caixas: readonly LinhaCaixa[]): DerivacaoCaixas {
  const ultima = caixas[caixas.length - 1]
  if (!ultima) return { seq: 1, limite: null, atualAberta: false, concluida: false, reabertas: [] }

  const atualAberta = !ultima.fechada
  // A caixa reaberta de maior seq VIRA a caixa atual (não havia outra sendo enchida depois dela).
  const seq = atualAberta ? ultima.seq : ultima.seq + 1
  const reabertas = caixas.filter((c) => !c.fechada && c.seq !== ultima.seq)
  return {
    seq,
    limite: ultima.limite, // limite é digitado uma vez e vale pras próximas caixas
    atualAberta,
    // Concluída = a última caixa foi fechada E marcada como última. Reabertas não desfazem isso
    // (a OP terminou); a tela só oferece o painel delas por cima do aviso de concluída.
    concluida: ultima.fechada && ultima.ultima,
    reabertas,
  }
}
