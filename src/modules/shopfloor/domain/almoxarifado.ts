import { separarCodigoCaixa } from './caixa'
import { normalizarSerie } from './serie'

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
  /** Só na caixa: quantas peças ainda não cumprem o posto anterior, e quantas a caixa tem. */
  faltam?: number
  pecas?: number
}): string {
  const { tipo, postoAnterior, precisaAprovado, faltam, pecas } = args
  if (tipo === 'caixa') {
    if (faltam !== undefined && pecas !== undefined && pecas > 0 && faltam > 0) {
      return `Esta caixa ainda não foi concluída no posto anterior (${postoAnterior}): ${faltam} de ${pecas} ${
        pecas === 1 ? 'peça' : 'peças'
      } ainda sem ${precisaAprovado ? 'aprovação' : 'registro'} lá.`
    }
    return `Esta caixa ainda não foi concluída no posto anterior (${postoAnterior}): todas as peças precisam estar ${
      precisaAprovado ? 'aprovadas' : 'registradas'
    } lá.`
  }
  return precisaAprovado
    ? `Esta peça ainda não foi aprovada no posto anterior (${postoAnterior}). Aprove a peça lá antes de dar entrada.`
    : `Esta peça ainda não passou pelo posto anterior (${postoAnterior}). Registre a peça lá antes de dar entrada.`
}

// ---------------------------------------------------------------------------------------------------
// FASE 2 (0156): o LOTE aprovado no NQA individual vira necessidade e é confirmado por AMOSTRA.
// ---------------------------------------------------------------------------------------------------

/**
 * Um lote do NQA individual que o Almoxarifado tem que confirmar (sf_almox_lotes, 0156): aprovado no
 * posto NQA anterior da rota, com SN ainda sem entrada. A pessoa bipa `amostra` SNs distintos do lote e
 * confirma; o ShopFloor grava uma entrada por SN e UM envio ao Compels.
 */
export interface NecessidadeLote {
  loteId: string
  /** 'LOTE[<8 hex>][<N>]' — o mesmo texto que vai ao Compels como bipe do envio. */
  rotulo: string
  /** SNs distintos do lote (o tamanho que decide a amostra). */
  pecas: number
  /** K da Tabela NQA pelo tamanho do lote. Nulo ou <= 0: a Tabela não tem amostra pra esse tamanho. */
  amostra: number | null
  /** TODOS os SNs do lote (normalizados), em ordem. */
  sns: string[]
  /** Quantos SNs do lote já entraram por fora (o normal é 0; > 0 a confirmação recusa). */
  jaLancadas: number
  aprovadoEm: string | null
}

/** A recusa `serie_exige_lote` (0156): na OP individual com NQA no anterior, a entrada é pelo lote. */
export const MENSAGEM_SERIE_EXIGE_LOTE = 'Esta peça faz parte de um lote do NQA: confirme o lote inteiro.'

export type ConferenciaAmostra =
  | { ok: true; bipados: string[] }
  | { ok: false; motivo: 'vazio' | 'fora_do_lote' | 'repetido' | 'completa'; sn: string }

/**
 * Um bipe da AMOSTRA, conferido na tela antes de ir ao banco (que confere tudo de novo): só SN do lote,
 * o mesmo SN não conta duas vezes, e a amostra não passa de K. A comparação é pela série NORMALIZADA,
 * a mesma forma que o NQA gravou em numero_serie_norm (e que vai à RPC).
 */
export function conferirBipeAmostra(lote: NecessidadeLote, bipados: string[], bipe: string): ConferenciaAmostra {
  const sn = normalizarSerie(bipe)
  if (sn === '') return { ok: false, motivo: 'vazio', sn: '' }
  if (bipados.includes(sn)) return { ok: false, motivo: 'repetido', sn }
  if (!lote.sns.includes(sn)) return { ok: false, motivo: 'fora_do_lote', sn }
  if (amostraCompleta(lote, bipados)) return { ok: false, motivo: 'completa', sn }
  return { ok: true, bipados: [...bipados, sn] }
}

/** "Confirmar lote" só habilita com EXATAMENTE K SNs distintos (e K válido). */
export function amostraCompleta(lote: NecessidadeLote, bipados: string[]): boolean {
  return lote.amostra !== null && lote.amostra > 0 && bipados.length === lote.amostra
}

/**
 * A frase de cada recusa da `sf_almoxarifado_lote` (0156). Quando a RPC manda `detalhe`, ele é a frase
 * pronta (com os SNs, quantos faltam, quando e por quem) e vale; sem ele, um texto fixo que ainda diz o
 * que aconteceu e o que fazer — nunca só "erro".
 */
export function mensagemRecusaLote(motivo: string, detalhe?: string): string {
  switch (motivo) {
    case 'sem_permissao':
      return 'Você não tem permissão para esta ação.'
    case 'ja_lancado':
      return detalhe || 'Este lote já foi confirmado.'
    case 'lote_com_sn_lancado':
      return detalhe
        || 'Alguma peça deste lote já tem entrada no Almoxarifado. Cancele essa entrada em Registros e confirme o lote outra vez.'
    case 'amostra_fora_do_lote':
      return detalhe || 'Uma das peças bipadas não é deste lote.'
    case 'amostra_tamanho_errado':
      return detalhe || 'A quantidade de peças da amostra não confere com a Tabela NQA.'
    case 'amostra_nqa_invalida':
      return detalhe || 'A Tabela NQA não tem amostra para o tamanho deste lote. Peça ao gestor para conferir a Tabela NQA.'
    case 'lote_nao_aprovado':
      return detalhe || 'Este lote não foi aprovado no NQA.'
    case 'lote_nao_encontrado':
      return detalhe || 'Lote não encontrado nesta OP.'
    case 'lote_nao_se_aplica':
      return detalhe || 'Nesta OP a entrada não é por lote do NQA.'
    case 'ordem_nao_encontrada':
      return detalhe || 'Ordem não encontrada.'
    case 'posto_invalido':
      return detalhe || 'Este posto não é um posto de Almoxarifado.'
    case 'posto_fora_da_op':
      return detalhe || 'Este posto não está nos postos desta OP. Acrescente-o em Cadastrar OP.'
    default:
      return 'Não foi possível confirmar o lote.'
  }
}

/** Uma pendência do Almoxarifado de QUALQUER OP (0158): uma caixa (OP coletiva) ou um lote do NQA (OP individual). */
export interface PendenciaAlmoxarifado {
  pmo: string
  op: string
  tipo: 'caixa' | 'lote'
  /** Código da caixa, ou o rótulo do lote ('LOTE[<8 hex>][<N>]'). */
  codigo: string
  pecas: number
  /** Só lote: K da Tabela NQA (nulo quando a Tabela não cobre o tamanho). */
  amostra: number | null
  /** Só lote: id do lote (p_lote_id do detalhe). */
  loteId: string | null
  /** Quando ficou pendente: fechada_em (caixa) ou aprovado_em (lote). */
  em: string | null
}

/** O detalhe de um cartão de pendência (sf_almox_detalhe, 0159). */
export interface DetalheAlmoxarifado {
  tipo: 'caixa' | 'lote'
  qtdOp: number | null
  recebidasOp: number
  postoAnterior: { posto: string; recurso: string; precisaAprovado: boolean } | null
  pecas: number
  sns: string[]
  /** fechada_em (caixa) ou aprovado_em (lote). */
  em: string | null
  /** Só caixa. */
  fechadaPor: string | null
  /** Só lote. */
  amostra: number | null
  /** Só lote. */
  jaLancadas: number
}

export interface OpComPendencia {
  chave: string
  pmo: string
  op: string
}

export function chaveDaOp(p: { pmo: string; op: string }): string {
  return `${p.op} · ${p.pmo}`
}

function compararOp(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.localeCompare(b, 'pt-BR', { numeric: true })
}

/** As OPs que têm pendência, uma entrada por (op, pmo), ordenadas por OP (numérica) e depois PMO. */
export function opsComPendencia(itens: PendenciaAlmoxarifado[]): OpComPendencia[] {
  const vistas = new Map<string, OpComPendencia>()
  for (const i of itens) {
    const chave = chaveDaOp(i)
    if (!vistas.has(chave)) vistas.set(chave, { chave, pmo: i.pmo, op: i.op })
  }
  return [...vistas.values()].sort((a, b) => compararOp(a.op, b.op) || a.pmo.localeCompare(b.pmo, 'pt-BR'))
}

/** `null` = todas as OPs. */
export function filtrarPorOp(itens: PendenciaAlmoxarifado[], chave: string | null): PendenciaAlmoxarifado[] {
  return chave === null ? itens : itens.filter((i) => chaveDaOp(i) === chave)
}

/** 'HH:MM' em America/Sao_Paulo; vazio se nulo ou inválido. */
export function horaCurta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}

const diaSP = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

/** "hoje HH:MM" se for do dia (America/Sao_Paulo), senão "dd/mm HH:MM"; vazio se nulo ou inválido. */
export function quandoCurto(iso: string | null, agora: Date = new Date()): string {
  const hora = horaCurta(iso)
  if (!hora) return ''
  const d = new Date(iso as string)
  if (diaSP(d) === diaSP(agora)) return `hoje ${hora}`
  const dm = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)
  return `${dm} ${hora}`
}

/** O código bipado confere com o da caixa (sem espaço nas pontas, sem diferença de maiúscula). */
export function codigoConfere(bipado: string, codigoDaCaixa: string): boolean {
  return (bipado ?? '').trim().toUpperCase() === (codigoDaCaixa ?? '').trim().toUpperCase()
}

/** A frase do banco quando a caixa/lote já não espera confirmação (a mesma das actions). */
export const FRASE_ITEM_NAO_PENDENTE = 'Esta caixa ou lote não está mais esperando confirmação. Atualize a lista.'

/** "1 peça" / "N peças". */
export const pecasTexto = (n: number) => (n === 1 ? '1 peça' : `${n} peças`)

export const FRASE_CAIXA_ERRADA = 'Este não é o código desta caixa. Confira a caixa na mão.'
