// Geometria do gráfico "Divergências por semana" — conta pura, testável sem DOM.
// UMA escala só (`y`) desenha as barras, as linhas de grade e os rótulos do eixo: o rótulo "4" fica
// exatamente na altura de uma barra de valor 4. Coordenadas 1:1 com pixels (a largura vem do
// container medido), então texto e linha não distorcem.
import type { SemanaDashboard } from './dashboard'

/** Passo "redondo" (1, 2, 5 × 10ⁿ), inteiro e ≥ 1, para ~4 divisões do eixo. */
export function passoRedondo(maximo: number): number {
  const bruto = maximo / 4
  if (bruto <= 1) return 1
  const potencia = 10 ** Math.floor(Math.log10(bruto))
  const m = bruto / potencia
  const redondo = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10
  return redondo * potencia
}

/** Topo do eixo e as marcas: 0, passo, 2·passo… até o topo (o topo é a última marca). */
export function eixoInteiro(maximo: number): { topo: number; marcas: number[] } {
  const passo = passoRedondo(Math.max(1, maximo))
  const topo = Math.max(passo, Math.ceil(maximo / passo) * passo)
  const marcas: number[] = []
  for (let v = 0; v <= topo; v += passo) marcas.push(v)
  return { topo, marcas }
}

export interface BarraSemana {
  inicio: string
  /** Canto esquerdo e largura da barra desenhada. */
  x: number
  largura: number
  /** Faixa clicável: a coluna inteira da semana (mais fácil de acertar que a barra). */
  xFaixa: number
  larguraFaixa: number
  /** Segmento de baixo: justificadas. */
  yJustificadas: number
  alturaJustificadas: number
  /** Segmento de cima: sem justificativa. */
  ySem: number
  alturaSem: number
  /** Rótulo do eixo X ('DD/MM'; 'DD/MM/AA' no primeiro e a cada ano novo quando o recorte atravessa anos) ou null quando é pulado para não encavalar. */
  rotulo: string | null
  /** Centro da coluna (onde o rótulo é ancorado). */
  centro: number
}

export interface GeometriaSemanas {
  largura: number
  altura: number
  esquerda: number
  topoPlot: number
  basePlot: number
  direita: number
  marcas: { valor: number; y: number }[]
  barras: BarraSemana[]
}

/** Altura total do SVG. */
export const ALTURA_GRAFICO = 220
const TOPO = 12          // folga em cima para o rótulo da marca mais alta não ser cortado
const BASE = 28          // faixa dos rótulos do eixo X
const DIREITA = 24       // metade de um 'DD/MM' (10 px de fonte ≈ 32 px de largura) + folga
const LARGURA_MAX_BARRA = 32
const ESPACO_ROTULO = 44 // distância mínima entre dois rótulos do eixo X, em px
const ESPACO_ROTULO_ANO = 56 // idem, quando algum rótulo leva o ano ('DD/MM/AA')
const LARGURA_DIGITO = 7 // largura aproximada de um algarismo a 11 px

/**
 * A geometria do gráfico para uma largura de container. A margem esquerda cresce com o número de
 * dígitos do maior rótulo do eixo Y — "1.500" precisa de mais espaço que "8".
 */
export function geometriaSemanas(semanas: SemanaDashboard[], larguraContainer: number): GeometriaSemanas {
  const largura = Math.max(280, Math.round(larguraContainer))
  const maximo = semanas.reduce((m, s) => Math.max(m, s.justificadas + s.semJustificativa), 0)
  const { topo, marcas } = eixoInteiro(maximo)
  const rotuloMaisLargo = new Intl.NumberFormat('pt-BR').format(topo).length
  const esquerda = 10 + rotuloMaisLargo * LARGURA_DIGITO
  const basePlot = ALTURA_GRAFICO - BASE
  const alturaPlot = basePlot - TOPO
  const larguraPlot = Math.max(1, largura - esquerda - DIREITA)
  const y = (v: number) => TOPO + alturaPlot * (1 - v / topo)

  const n = semanas.length
  const coluna = n > 0 ? larguraPlot / n : larguraPlot
  const larguraBarra = Math.max(1, Math.min(LARGURA_MAX_BARRA, coluna * 0.7))
  // Recorte que atravessa a virada do ano: 'DD/MM' fica ambíguo, então o primeiro rótulo e o
  // primeiro de cada ano novo levam o ano ('DD/MM/AA'), e o espaçamento sobe para caber.
  const anoDe = (inicio: string) => inicio.slice(0, 4)
  const variosAnos = n > 0 && anoDe(semanas[0]!.inicio) !== anoDe(semanas[n - 1]!.inicio)
  const passoRotulo = Math.max(1, Math.ceil((variosAnos ? ESPACO_ROTULO_ANO : ESPACO_ROTULO) / coluna))
  let anoDoUltimoRotulo = ''

  const rotular = (i: number, inicio: string, dia: string, mes: string): string | null => {
    if (i % passoRotulo !== 0) return null
    const ano = anoDe(inicio)
    const comAno = variosAnos && ano !== anoDoUltimoRotulo
    anoDoUltimoRotulo = ano
    return comAno ? `${dia}/${mes}/${ano.slice(2)}` : `${dia}/${mes}`
  }

  const barras = semanas.map((s, i): BarraSemana => {
    const xFaixa = esquerda + i * coluna
    const yJ = y(s.justificadas)
    const yS = y(s.justificadas + s.semJustificativa)
    const [, mes, dia] = s.inicio.split('-')
    return {
      inicio: s.inicio,
      x: xFaixa + (coluna - larguraBarra) / 2,
      largura: larguraBarra,
      xFaixa,
      larguraFaixa: coluna,
      yJustificadas: yJ,
      alturaJustificadas: basePlot - yJ,
      ySem: yS,
      alturaSem: yJ - yS,
      rotulo: rotular(i, s.inicio, dia!, mes!),
      centro: xFaixa + coluna / 2,
    }
  })

  return {
    largura,
    altura: ALTURA_GRAFICO,
    esquerda,
    topoPlot: TOPO,
    basePlot,
    direita: largura - DIREITA,
    marcas: marcas.map((valor) => ({ valor, y: y(valor) })),
    barras,
  }
}
