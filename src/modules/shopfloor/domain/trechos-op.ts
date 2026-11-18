/** Trechos de uma OP já criada (0184), para o seletor do Fluxo: cada trecho e os seus postos, na ordem da rota. */
export interface TrechoDaOp {
  seq: number
  codigo: string
  tipo: 'prt' | 'pmo'
  compelsOp: string | null
  postos: string[]
}

export function rotuloTrechoDaOp(t: TrechoDaOp): string {
  return t.compelsOp ? `${t.codigo} (${t.compelsOp})` : t.codigo
}

/** Postos a destacar com o trecho escolhido. null = "Todos" (ou trecho que não existe): nada esmaece. */
export function realceDoTrecho(trechos: TrechoDaOp[], seq: number | null): Set<string> | null {
  if (seq === null) return null
  const t = trechos.find((x) => x.seq === seq)
  return t ? new Set(t.postos) : null
}
