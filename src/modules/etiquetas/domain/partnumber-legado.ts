/**
 * Etiqueta do ESTOQUE LEGADO — material que entrou antes do ShopFloor existir e nunca ganhou
 * etiqueta (spec docs/superpowers/specs/2026-09-24-etiquetas-estoque-legado-design.md).
 *
 * Pedido, DI e nota fiscal desse material são irrecuperáveis, então a etiqueta carrega só o que a
 * montagem do Setup precisa:
 *
 *     CAPA78-L0001
 *     └ item ┘ └ lote livre: L de "legado" + sequencial do rolo ┘
 *
 * O Setup parte o código no PRIMEIRO separador (ver `setup/domain/codigo-rolo.ts`): antes = o
 * componente, que tem de existir na estrutura da PMO; depois = lote, texto livre.
 *
 * Ferramenta de mutirão: roda uma vez sobre o estoque antigo. Nada aqui toca a etiqueta do
 * material novo (`partnumber.ts`) — só reaproveita `gerarCsv`/`formatarVolume` para o arquivo sair
 * byte a byte no formato que a impressora já conhece.
 */

import { formatarVolume, type LinhaEtiqueta } from './partnumber'

/** Marca de material legado no lote. `L` e não `GEN`: barra menor, barra mais fácil de ler. */
export const MARCA_LEGADO = 'L'

/**
 * Teto de etiquetas por geração. O número é 1.000 porque o PostgREST corta QUALQUER resposta em
 * 1.000 linhas (`supabase/config.toml`: max_rows): acima disso o banco emitiria etiquetas que não
 * voltariam para o arquivo — rolo sem etiqueta e código gasto, em silêncio. O estoque antigo tem
 * até 5.000 rolos, e a spec já recomenda gerar por coluna da prateleira. Espelha etq_legado_emitir.
 */
export const LIMITE_LINHAS_LEGADO = 1000

/** Separadores que o Setup usa para partir o código do rolo (espelha `contemSeparador`). */
const SEPARADOR = /[-–—_:/\s]/

/** Locação do ERP: `coluna.lado.posição` (ex.: `A1.C.66`). */
const PADRAO_LOCACAO = /^[A-Z0-9]+\.[A-Z]+\.\d+$/

/** Uma linha da planilha "Saldo por Locação" — cada linha é um rolo físico. */
export interface LinhaSaldo {
  /** Número da linha na planilha (1-based, como o Excel mostra), para o usuário achar o problema. */
  linhaPlanilha: number
  item: string
  descricao: string
  locacao: string
}

/** Por que a linha NÃO gera etiqueta. */
export type MotivoRecusa = 'sem_item' | 'item_com_separador'

/** Por que a linha é duvidosa — gera, mas aparece sinalizada na prévia. */
export type MotivoAviso = 'locacao_malformada' | 'repetida_na_planilha' | 'ja_etiquetada'

/** O que já foi emitido para um par (item, locação), vindo de `etq_legado_conferir`. */
export interface ConferenciaLegado {
  item: string
  locacao: string
  /** Quantas etiquetas este item já ganhou NESTA locação. */
  emitidasNaLocacao: number
  /** Data da última delas (ISO), ou null. É o que a prévia mostra para o usuário decidir. */
  ultimaNaLocacao: string | null
  /** Onde o contador do ITEM está hoje (0 = nunca etiquetado). */
  ultimoSequencial: number
}

export interface LinhaAvaliada extends LinhaSaldo {
  /** Posição na planilha entre as linhas lidas (1-based). A ordem importa: quem cola segue ela. */
  ordem: number
  /** null = pode gerar. */
  recusa: MotivoRecusa | null
  avisos: MotivoAviso[]
  /** Data da última etiqueta deste item nesta locação (ISO), quando houver. */
  ultimaNaLocacao: string | null
  /**
   * Código que a linha deve receber, projetado a partir do contador de hoje. É PREVISÃO: o número
   * definitivo é atribuído pelo banco na geração (`etq_legado_emitir`), que é quem garante que
   * ninguém repete. Vazio nas linhas recusadas.
   */
  codigoPrevisto: string
}

export interface ResumoPrevia {
  /** Linhas que vão gerar etiqueta. */
  aEtiquetar: number
  recusadas: number
  semItem: number
  itemComSeparador: number
  locacaoMalformada: number
  repetidasNaPlanilha: number
  jaEtiquetadas: number
}

export function normalizarItem(valor: unknown): string {
  return String(valor ?? '').trim().toUpperCase()
}

/**
 * Locação da planilha para a forma comparável. O ERP exporta a coluna como FAIXA
 * (`A1.C.15 - A1.C.15`); o que interessa é a posição inicial. Sem faixa, usa o valor inteiro.
 */
export function normalizarLocacao(valor: unknown): string {
  const texto = String(valor ?? '').trim().toUpperCase()
  const [inicio] = texto.split(' - ')
  return (inicio ?? '').trim()
}

/** True sse a locação segue `coluna.lado.posição`. Fora do padrão é aviso, nunca recusa. */
export function locacaoValida(locacao: string): boolean {
  return PADRAO_LOCACAO.test(locacao)
}

/**
 * Item que o Setup consegue ler como prefixo do rolo. Vazio não dá etiqueta, e item COM separador
 * quebraria a divisão do código (o Setup leria só o pedaço antes do separador como componente) —
 * as duas coisas são recusa. Espelha `etq_legado_item_valido` na 0126.
 */
export function recusaDoItem(item: string): MotivoRecusa | null {
  if (item === '') return 'sem_item'
  if (SEPARADOR.test(item)) return 'item_com_separador'
  return null
}

/** `CAPA78` + 1 → `CAPA78-L0001`. Espelha `etq_legado_codigo` na 0126. */
export function montarPartNumberLegado(item: string, sequencial: number): string {
  const numero = Math.trunc(sequencial)
  const lote = numero < 10000 ? String(numero).padStart(4, '0') : String(numero)
  return `${normalizarItem(item)}-${MARCA_LEGADO}${lote}`
}

/**
 * A locação partida em (coluna, lado, posição) para ORDENAR a leva na ordem da prateleira.
 *
 * Ordenar como texto não serve: `A1.C.66` vem antes de `A1.C.7`, e quem cola andaria para frente e
 * para trás na estante. A posição é comparada como NÚMERO; coluna e lado, como texto.
 * Locação fora do padrão devolve null — vai para o fim da lista, nunca some.
 */
export function partesDaLocacao(locacao: string): { coluna: string; lado: string; posicao: number } | null {
  const casou = /^([A-Z0-9]+)\.([A-Z]+)\.(\d+)$/.exec(normalizarLocacao(locacao))
  if (!casou) return null
  return { coluna: casou[1] ?? '', lado: casou[2] ?? '', posicao: Number(casou[3] ?? 0) }
}

/**
 * As linhas da planilha na ordem de quem caminha a prateleira: por coluna, por lado, e por posição
 * em ordem numérica. A ordem da lista É a ordem de impressão e a ordem da colagem — é por isso que
 * ela é decidida aqui e não na tela.
 *
 * O ERP não garante ordem nenhuma no export. Linhas com locação fora do padrão ficam no fim, na
 * ordem em que vieram, para quem cola tratá-las à parte.
 */
export function ordenarPorPrateleira(linhas: LinhaSaldo[]): LinhaSaldo[] {
  return linhas
    .map((linha, i) => ({ linha, i, partes: partesDaLocacao(linha.locacao) }))
    .sort((a, b) => {
      if (!a.partes || !b.partes) {
        if (a.partes) return -1
        if (b.partes) return 1
        return a.i - b.i
      }
      if (a.partes.coluna !== b.partes.coluna) return a.partes.coluna.localeCompare(b.partes.coluna)
      if (a.partes.lado !== b.partes.lado) return a.partes.lado.localeCompare(b.partes.lado)
      if (a.partes.posicao !== b.partes.posicao) return a.partes.posicao - b.partes.posicao
      return a.i - b.i
    })
    .map((x) => x.linha)
}

/** Chave de repetição: mesmo item na mesma posição da prateleira. */
export function chaveItemLocacao(item: string, locacao: string): string {
  return `${item}|${locacao}`
}

/**
 * Avalia as linhas lidas da planilha contra o que já foi etiquetado, na ordem em que vieram.
 *
 * Nada aqui decide sozinho: o que está bom é marcado para gerar, o que é duvidoso ganha aviso e
 * continua na lista (a tela deixa o usuário escolher linha por linha). Só item vazio ou com
 * separador é recusado — esses não viram etiqueta que o Setup leia.
 *
 * O `codigoPrevisto` avança o contador de cada item dentro da própria leva, para a prévia mostrar
 * 0001, 0002, 0003 quando o mesmo item aparece três vezes.
 */
export function avaliarLinhas(linhas: LinhaSaldo[], conferencias: ConferenciaLegado[]): LinhaAvaliada[] {
  const porPar = new Map<string, ConferenciaLegado>()
  const ultimoPorItem = new Map<string, number>()
  for (const c of conferencias) {
    porPar.set(chaveItemLocacao(c.item, c.locacao), c)
    const atual = ultimoPorItem.get(c.item) ?? 0
    if (c.ultimoSequencial > atual) ultimoPorItem.set(c.item, c.ultimoSequencial)
  }

  // Quantas vezes cada par (item, locação) aparece NESTA planilha: 2+ é repetição a sinalizar.
  const vezesNaPlanilha = new Map<string, number>()
  for (const linha of linhas) {
    const item = normalizarItem(linha.item)
    const locacao = normalizarLocacao(linha.locacao)
    if (recusaDoItem(item)) continue
    const chave = chaveItemLocacao(item, locacao)
    vezesNaPlanilha.set(chave, (vezesNaPlanilha.get(chave) ?? 0) + 1)
  }

  const proximoPorItem = new Map<string, number>()
  return linhas.map((linha, i) => {
    const item = normalizarItem(linha.item)
    const locacao = normalizarLocacao(linha.locacao)
    const recusa = recusaDoItem(item)
    const conferencia = porPar.get(chaveItemLocacao(item, locacao))

    const avisos: MotivoAviso[] = []
    if (!recusa) {
      if (!locacaoValida(locacao)) avisos.push('locacao_malformada')
      if ((vezesNaPlanilha.get(chaveItemLocacao(item, locacao)) ?? 0) > 1) avisos.push('repetida_na_planilha')
      if ((conferencia?.emitidasNaLocacao ?? 0) > 0) avisos.push('ja_etiquetada')
    }

    let codigoPrevisto = ''
    if (!recusa) {
      const anterior = proximoPorItem.get(item) ?? ultimoPorItem.get(item) ?? 0
      const sequencial = anterior + 1
      proximoPorItem.set(item, sequencial)
      codigoPrevisto = montarPartNumberLegado(item, sequencial)
    }

    return {
      ordem: i + 1,
      linhaPlanilha: linha.linhaPlanilha,
      item,
      descricao: String(linha.descricao ?? '').trim(),
      locacao,
      recusa,
      avisos,
      ultimaNaLocacao: conferencia?.ultimaNaLocacao ?? null,
      codigoPrevisto,
    }
  })
}

/** Contagens da prévia: o que vai gerar, o que foi recusado e por quê, o que é duvidoso. */
export function resumirPrevia(avaliadas: LinhaAvaliada[]): ResumoPrevia {
  const conta = (motivo: MotivoAviso) => avaliadas.filter((l) => l.avisos.includes(motivo)).length
  return {
    aEtiquetar: avaliadas.filter((l) => l.recusa === null).length,
    recusadas: avaliadas.filter((l) => l.recusa !== null).length,
    semItem: avaliadas.filter((l) => l.recusa === 'sem_item').length,
    itemComSeparador: avaliadas.filter((l) => l.recusa === 'item_com_separador').length,
    locacaoMalformada: conta('locacao_malformada'),
    repetidasNaPlanilha: conta('repetida_na_planilha'),
    jaEtiquetadas: conta('ja_etiquetada'),
  }
}

/** Uma etiqueta emitida, como `etq_legado_emitir` devolve. */
export interface EtiquetaLegadoEmitida {
  /** Posição na leva enviada, para remontar a ORDEM da planilha. */
  ordem: number
  item: string
  sequencial: number
  codigo: string
  locacao: string
}

/**
 * As etiquetas emitidas nas três colunas do arquivo de hoje, na ordem da planilha.
 *
 * O `codigo` vem do banco (autoritativo) e é conferido contra o formato do domínio: se as duas
 * formas divergirem, a geração para em vez de imprimir um código que o Setup não vai ler.
 *
 * Terceira coluna = `01-01`: cada linha da planilha JÁ É um rolo, então é sempre volume 1 de 1 —
 * a coluna existe para o modelo da impressora continuar idêntico.
 */
export function linhasDoArquivoLegado(emitidas: EtiquetaLegadoEmitida[]): LinhaEtiqueta[] {
  return [...emitidas]
    .sort((a, b) => a.ordem - b.ordem)
    .map((e) => {
      const esperado = montarPartNumberLegado(e.item, e.sequencial)
      if (e.codigo !== esperado) {
        throw new Error(`Código divergente para ${e.item}: banco "${e.codigo}", formato "${esperado}".`)
      }
      return { partNumber: e.codigo, codigo: normalizarItem(e.item), volume: formatarVolume(1, 1) }
    })
}
