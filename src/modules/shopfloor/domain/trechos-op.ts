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

/** Números de um trecho para o botão e o resumo do seletor. `quantidade` = da OP (null quando a OP não tem). */
export interface ProgressoTrecho {
  concluidas: number
  quantidade: number | null
  reprovadas: number
  /** Só PRT (o que o Compels já recebeu / o que espera envio). PMO: null. */
  apontadas: number | null
  naFila: number | null
}

/** O mínimo de cada card de posto que o progresso usa. */
export interface ContagemDoPosto { passou: number; reprovadas: number }
/** O mínimo do resumo do Compels por trecho (sf_resumo_trechos_op). */
export interface CompelsDoTrecho { posto: string; codigo: string; apontadas: number; naFila: number }

/**
 * Progresso por trecho (seq → números). Concluídas = peças que passaram no posto que CONCLUI o trecho (o de
 * sf_resumo_trechos_op; sem ele, o último posto do trecho que está no desenho). Reprovadas = soma das reprovações
 * nos postos do trecho. Trecho sem nenhum posto no desenho fica de fora.
 */
export function progressoDosTrechos(
  trechos: TrechoDaOp[],
  postos: ReadonlyMap<string, ContagemDoPosto>,
  compels: CompelsDoTrecho[],
  quantidade: number | null,
): Map<number, ProgressoTrecho> {
  const out = new Map<number, ProgressoTrecho>()
  for (const t of trechos) {
    const noDesenho = t.postos.filter((p) => postos.has(p))
    if (noDesenho.length === 0) continue
    const c = compels.find((x) => x.codigo === t.codigo)
    const conclui = c && postos.has(c.posto) ? c.posto : noDesenho[noDesenho.length - 1]!
    const prt = t.tipo === 'prt'
    out.set(t.seq, {
      concluidas: postos.get(conclui)?.passou ?? 0,
      quantidade: quantidade != null && quantidade > 0 ? quantidade : null,
      reprovadas: noDesenho.reduce((s, p) => s + (postos.get(p)?.reprovadas ?? 0), 0),
      apontadas: prt ? (c?.apontadas ?? 0) : null,
      naFila: prt ? (c?.naFila ?? 0) : null,
    })
  }
  return out
}

/** Moldura de um trecho no desenho, em coordenadas do fluxo. */
export interface MolduraTrecho { seq: number; rotulo: string; x: number; y: number; largura: number; altura: number }
/** Um posto no desenho: posição e tamanho (medido; sem medida, o tamanho padrão do card). */
export interface CaixaDoPosto { id: string; x: number; y: number; largura?: number; altura?: number }

const FOLGA_MOLDURA = 20
/** Espaço extra no topo para o rótulo da moldura não cobrir o card. */
const FOLGA_ROTULO = 26
const LARGURA_CARD = 240
const ALTURA_CARD = 160

/** "PRT410 · OP 8500" (sem OP no Compels: só o código). */
export function rotuloMolduraTrecho(t: TrechoDaOp): string {
  return t.compelsOp ? `${t.codigo} · OP ${t.compelsOp}` : t.codigo
}

/**
 * Uma moldura por trecho, em volta dos postos dele que estão no desenho (+ folga). Só com 2 ou mais trechos.
 * `fora` = postos que nunca entram numa moldura (Entrada, Saída/Finalizadas, Manutenção).
 */
export function moldurasDosTrechos(trechos: TrechoDaOp[], caixas: CaixaDoPosto[], fora: ReadonlySet<string>): MolduraTrecho[] {
  if (trechos.length < 2) return []
  const porId = new Map(caixas.map((c) => [c.id, c]))
  const out: MolduraTrecho[] = []
  for (const t of trechos) {
    const cs = t.postos.filter((p) => !fora.has(p)).map((p) => porId.get(p)).filter((c): c is CaixaDoPosto => !!c)
    if (cs.length === 0) continue
    const x0 = Math.min(...cs.map((c) => c.x))
    const y0 = Math.min(...cs.map((c) => c.y))
    const x1 = Math.max(...cs.map((c) => c.x + (c.largura || LARGURA_CARD)))
    const y1 = Math.max(...cs.map((c) => c.y + (c.altura || ALTURA_CARD)))
    out.push({
      seq: t.seq,
      rotulo: rotuloMolduraTrecho(t),
      x: x0 - FOLGA_MOLDURA,
      y: y0 - FOLGA_MOLDURA - FOLGA_ROTULO,
      largura: x1 - x0 + 2 * FOLGA_MOLDURA,
      altura: y1 - y0 + 2 * FOLGA_MOLDURA + FOLGA_ROTULO,
    })
  }
  return out
}
