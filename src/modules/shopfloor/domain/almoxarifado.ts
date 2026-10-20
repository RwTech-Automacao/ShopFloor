import { separarCodigoCaixa } from './caixa'

export type TipoBipeAlmoxarifado = 'serie' | 'caixa'

export type RecusaBipeAlmoxarifado =
  | 'vazio'
  | 'caixa_aberta' // CX[3] sem a quantidade: caixa que não fechou não tem quantidade
  | 'caixa_em_op_individual'
  | 'serie_em_op_coletiva'

export interface BipeAlmoxarifado {
  tipo: TipoBipeAlmoxarifado
  /**
   * Série tal como bipada (só sem espaço nas pontas), quando o bipe é de peça. NÃO passa por
   * `normalizarSerie` aqui: essa série pode vir no formato de revenda (ex.: "00043-00462-0015718",
   * onde "00043" é o código da revenda, não zero à esquerda pra descartar — ver repinmetro.ts) e
   * `normalizarSerie`/`limparSerie` corrompem esse prefixo. A comparação/dedup fica pra quem grava
   * a entrada no banco, que decide qual forma normalizada usar pra cada caso.
   */
  serie: string
  /** Código completo da caixa, quando o bipe é de caixa. */
  codigoCaixa: string
  /** Quantidade que o bipe representa: 1 na peça, a qtd do código na caixa. */
  quantidade: number
}

/**
 * Decide, só pelo FORMATO do que foi bipado no Almoxarifado, se é uma peça (série) ou uma caixa
 * coletiva — e recusa o que o formato sozinho já resolve. Não toca o banco: caixa já lançada ou
 * reprovada no NQA são validações de DADO e ficam por conta do RPC que grava a entrada.
 *
 * A quantidade da caixa vem do próprio código bipado (via `separarCodigoCaixa`), nunca de consulta
 * à tabela — é o número impresso na etiqueta colada na caixa física, e é ele que o operador leu.
 */
export function classificarBipeAlmoxarifado(
  bipe: string,
  embalagemIndividual: boolean,
): { ok: true; bipe: BipeAlmoxarifado } | { ok: false; recusa: RecusaBipeAlmoxarifado } {
  const lido = (bipe ?? '').trim()
  if (lido === '') return { ok: false, recusa: 'vazio' }

  if (lido.startsWith('CX[')) {
    if (embalagemIndividual) return { ok: false, recusa: 'caixa_em_op_individual' }
    const separada = separarCodigoCaixa(lido)
    // separarCodigoCaixa só devolve algo pra código FECHADO; null cobre tanto o marcador de caixa
    // ainda aberta (CX[seq]) quanto qualquer outra coisa que comece com "CX[" sem ser um código
    // válido — em ambos os casos não há quantidade pra dar entrada.
    if (!separada) return { ok: false, recusa: 'caixa_aberta' }
    return {
      ok: true,
      bipe: { tipo: 'caixa', serie: '', codigoCaixa: lido, quantidade: separada.qtd },
    }
  }

  if (!embalagemIndividual) return { ok: false, recusa: 'serie_em_op_coletiva' }
  return {
    ok: true,
    bipe: { tipo: 'serie', serie: lido, codigoCaixa: '', quantidade: 1 },
  }
}

/**
 * Uma caixa que o Almoxarifado tem que confirmar (sf_almox_necessidades, 0155): fechada, concluída no
 * posto anterior da rota e ainda sem entrada. Confirmar é o bipe de hoje (o código da caixa).
 */
export interface NecessidadeAlmoxarifado {
  codigo: string
  seq: number
  /** Peças da caixa, contadas nas linhas da Embalagem — o número que a entrada vai gravar. */
  pecas: number
  fechadaEm: string | null
}

/**
 * A frase da recusa `posto_anterior_nao_concluido` (0155): o posto imediatamente antes do
 * Almoxarifado na rota ainda não concluiu a peça/caixa. Diz QUAL posto e o que falta — aprovar (posto
 * com status, gate 'aprovado') ou só passar por ele (gate 'registrado') —, que é o que o operador
 * precisa pra saber pra onde levar a peça.
 */
export function mensagemPostoAnteriorNaoConcluido(args: {
  tipo: TipoBipeAlmoxarifado
  postoAnterior: string
  precisaAprovado: boolean
}): string {
  const { tipo, postoAnterior, precisaAprovado } = args
  if (tipo === 'caixa') {
    return `Esta caixa ainda não foi concluída no posto anterior (${postoAnterior}): todas as peças precisam estar ${
      precisaAprovado ? 'aprovadas' : 'registradas'
    } lá.`
  }
  return precisaAprovado
    ? `Esta peça ainda não foi aprovada no posto anterior (${postoAnterior}). Aprove a peça lá antes de dar entrada.`
    : `Esta peça ainda não passou pelo posto anterior (${postoAnterior}). Registre a peça lá antes de dar entrada.`
}
