// Onde cada item de uma EMB está e como ele andou. Regra pura (sem banco): as telas de Fluxo e de
// Registros do Recebimento leem daqui, e as funções `rec_*` da migração 0124 espelham estas regras
// em SQL (é lá que a agregação roda — `logs` é global e cresce).
//
//   Recebimento ──► Qualidade ──► Almoxarifado
//                       │
//                       └──► Reprovado na Qualidade   (fim de linha)
//
// Divergência de Quantidade é MARCA que viaja com o item, não caixa: o item divergente continua o
// fluxo normalmente e a marca some sozinha quando a quantidade é corrigida (o campo é recalculado).

/** As quatro caixas do fluxo. `reprovado` é saída lateral (fim de linha), não etapa de passagem. */
export type Etapa = 'recebimento' | 'qualidade' | 'almoxarifado' | 'reprovado'

/** Ordem em que as caixas aparecem na tela (a lateral por último). */
export const ETAPAS: readonly Etapa[] = ['recebimento', 'qualidade', 'almoxarifado', 'reprovado']

export const ROTULO_ETAPA: Record<Etapa, string> = {
  recebimento: 'Recebimento',
  qualidade: 'Qualidade',
  almoxarifado: 'Almoxarifado',
  reprovado: 'Reprovado na Qualidade',
}

/** As duas seções de conferência do processo (`configuracao_campos.grupo`). */
export type Secao = 'recebimento' | 'qualidade'

export function ehEtapa(valor: string): valor is Etapa {
  return (ETAPAS as readonly string[]).includes(valor)
}

/**
 * Divergência de Quantidade. O campo é CALCULADO pelo sistema
 * (`quantidade_recebida − quantidade_pedido`) e guardado como texto:
 *  - vazio → ainda não conferido, NÃO é divergência;
 *  - zero → sem divergência;
 *  - qualquer outro número, positivo ou negativo → tem divergência;
 *  - texto que não é número → sem divergência (não inventa significado).
 */
export function temDivergencia(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false
  const texto = String(valor).trim()
  if (texto === '') return false
  // Vírgula decimal: o campo é texto livre no banco e já recebeu valor digitado no passado.
  const n = Number(texto.replace(',', '.'))
  return Number.isFinite(n) && n !== 0
}

/**
 * Caixa de destino de uma finalização, a partir do valor de "Resultado".
 *
 * "Reprovado" é a ÚNICA saída lateral; qualquer outro resultado conta como Almoxarifado. É decisão
 * consciente: a lista "Resultado" é configurável em Configurações › Listas, então um valor novo de
 * aprovação (ex.: "Aprovado com ressalva") entra no fluxo sozinho, sem mexer em código. O risco
 * aceito é o contrário — "Reprovado parcial" cairia no Almoxarifado; se acontecer, a correção é
 * listar explicitamente quais resultados são aprovação.
 */
export function etapaPorResultado(resultado: string): 'almoxarifado' | 'reprovado' {
  return resultado.trim().toLowerCase() === 'reprovado' ? 'reprovado' : 'almoxarifado'
}

/**
 * Caixa em que o item está AGORA, pelo status do processo. `aberto` = esperando conferência
 * (Recebimento); `em_conferencia` = conferência começou (Qualidade — a promoção acontece no 1º
 * salvamento de seção); qualquer outro status é terminal e vale o valor do Resultado.
 */
export function etapaPorStatus(status: string): Etapa {
  const s = status.trim()
  if (s === 'aberto') return 'recebimento'
  if (s === 'em_conferencia') return 'qualidade'
  return etapaPorResultado(s)
}

/**
 * Seção salva, pelo GRUPO dos campos que o diff do log tocou. É o caminho preferido (funciona para
 * o histórico antigo também, sem interpretar texto). `null` quando o diff não decide: diff vazio
 * (salvar sem alterar nada gera log com `dados: []`) ou diff que só tocou campos base
 * (comercial/material), que as duas seções gravam.
 *
 * Diff que toca os dois grupos: Qualidade vence. Não acontece hoje — `salvarSecaoProcesso` só
 * aceita campos de comercial + material + a seção salva —, mas é o desempate previsível.
 */
export function secaoDoDiff(gruposTocados: readonly string[]): Secao | null {
  if (gruposTocados.includes('qualidade')) return 'qualidade'
  if (gruposTocados.includes('recebimento')) return 'recebimento'
  return null
}

/** Seção nomeada na descrição do log ("Processo #123 — seção recebimento salva"). Só é usada quando
 *  o diff não decide — é o desempate, não a fonte. */
export function secaoDaDescricao(descricao: string): Secao | null {
  const m = /seção (recebimento|qualidade) salva/.exec(descricao)
  return m ? (m[1] as Secao) : null
}

/** O que um evento fez com o item. */
export type TipoPassagem =
  | 'criacao' // nasceu (importação ou cadastro manual) → Recebimento
  | 'avanco' // andou uma caixa
  | 'edicao' // alterou campos sem sair da caixa
  | 'reabertura' // voltou de um terminal para a Qualidade

export interface Passagem {
  tipo: TipoPassagem
  /** Caixa de onde saiu. `null` na criação e na edição (não saiu de lugar nenhum). */
  de: Etapa | null
  /** Caixa em que o item ficou depois do evento. */
  para: Etapa
  /** Valor de "Resultado" da finalização, para mostrar entre parênteses. */
  resultado: string | null
}

/** Um log de `entidade = 'processo'` no cru, já com os grupos do diff resolvidos. */
export interface EventoLog {
  acao: string
  descricao: string
  /** Grupos (`configuracao_campos.grupo`) dos campos que o diff tocou. Vazio = diff vazio. */
  gruposTocados: readonly string[]
  /** `dados.de` dos logs de `mudar_status`. */
  statusDe: string | null
  /** `dados.para` dos logs de `mudar_status`. */
  statusPara: string | null
}

/**
 * Traduz um log em passagem de etapa. `null` = evento que não diz nada sobre o fluxo (foto
 * anexada, promoção automática `aberto → em_conferencia`, log de seção que não dá para derivar).
 *
 * A promoção automática é ignorada de propósito: ela acontece JUNTO com o 1º salvamento de seção,
 * que já gera o evento da passagem — contar as duas mostraria o mesmo movimento duas vezes.
 */
export function passagemDoEvento(evento: EventoLog): Passagem | null {
  if (evento.acao === 'criar') {
    return { tipo: 'criacao', de: null, para: 'recebimento', resultado: null }
  }

  if (evento.acao === 'mudar_status') {
    const de = (evento.statusDe ?? '').trim()
    const para = (evento.statusPara ?? '').trim()
    if (para === 'em_conferencia') {
      if (de === 'aberto' || de === '') return null // promoção automática do 1º salvamento
      return { tipo: 'reabertura', de: etapaPorResultado(de), para: 'qualidade', resultado: null }
    }
    if (para === '' || para === 'aberto') return null
    return { tipo: 'avanco', de: 'qualidade', para: etapaPorResultado(para), resultado: para }
  }

  if (evento.acao === 'alterar_campo') {
    const secao = secaoDoDiff(evento.gruposTocados) ?? secaoDaDescricao(evento.descricao)
    // Salvar a seção Recebimento é o que passa o item para a Qualidade. Salvar a seção Qualidade é
    // trabalho DENTRO da Qualidade: o item só sai dali ao finalizar.
    if (secao === 'recebimento') {
      return { tipo: 'avanco', de: 'recebimento', para: 'qualidade', resultado: null }
    }
    if (secao === 'qualidade') {
      return { tipo: 'edicao', de: null, para: 'qualidade', resultado: null }
    }
  }

  return null
}

/** Texto da coluna Etapa do Registros. */
export function rotuloPassagem(p: Passagem): string {
  const destino = ROTULO_ETAPA[p.para]
  if (p.tipo === 'criacao') return `→ ${destino}`
  if (p.tipo === 'edicao') return destino
  const origem = p.de ? ROTULO_ETAPA[p.de] : ''
  const sufixo = p.tipo === 'reabertura' ? ' (reaberto)' : p.resultado ? ` (${p.resultado})` : ''
  return `${origem} → ${destino}${sufixo}`
}

/** Onde o item está agora e desde quando. `desde: null` = não deu para saber (mostrar "—"). */
export interface SituacaoAtual {
  etapa: Etapa
  desde: string | null
}

/**
 * Caixa atual do item + a hora em que ele entrou nela.
 *
 * O status manda na caixa (é o estado atual, sempre confiável); o histórico só diz DESDE QUANDO.
 * A hora de entrada é o começo da última corrida de eventos na caixa atual — assim vários
 * salvamentos seguidos na Qualidade não "reiniciam o relógio", e uma reabertura reinicia (ela
 * quebra a corrida).
 *
 * Processo sem histórico (criado antes do log, ou log que não permite derivar a etapa) cai na
 * caixa do status com `desde: null` — a tela mostra "—", não zero.
 */
export function situacaoAtual(entrada: {
  status: string
  criadoEm: string
  finalizadoEm: string | null
  /** Eventos derivados, em ordem cronológica: a caixa em que o item ficou em cada um. */
  eventos: readonly { em: string; etapa: Etapa }[]
}): SituacaoAtual {
  const etapa = etapaPorStatus(entrada.status)
  // Entrar no Recebimento é nascer: `created_at` é not null, então aqui nunca falta o tempo.
  if (etapa === 'recebimento') return { etapa, desde: entrada.criadoEm }

  let inicio: string | null = null
  for (let i = entrada.eventos.length - 1; i >= 0; i--) {
    const ev = entrada.eventos[i]!
    if (ev.etapa !== etapa) break
    inicio = ev.em
  }
  if (inicio !== null) return { etapa, desde: inicio }

  // Sem corrida na caixa atual: o terminal ainda tem `finalizado_em` (coluna do processo).
  const terminal = etapa === 'almoxarifado' || etapa === 'reprovado'
  return { etapa, desde: terminal ? entrada.finalizadoEm : null }
}

/**
 * "há quanto tempo" em texto curto, a partir de segundos. No Recebimento um item fica parado dias,
 * não minutos — por isso a maior unidade é o dia. `null` (tempo desconhecido) vira "—": a tela não
 * mostra zero nem inventa.
 */
export function formatarEspera(segundos: number | null): string {
  if (segundos === null || !Number.isFinite(segundos)) return '—'
  const total = Math.max(0, Math.floor(segundos))
  const dias = Math.floor(total / 86_400)
  const horas = Math.floor((total % 86_400) / 3_600)
  const min = Math.floor((total % 3_600) / 60)
  if (dias > 0) return horas > 0 ? `${dias} d ${horas} h` : `${dias} d`
  if (horas > 0) return min > 0 ? `${horas} h ${min} min` : `${horas} h`
  if (min > 0) return `${min} min`
  return 'menos de 1 min'
}
