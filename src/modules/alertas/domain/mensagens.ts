import {
  capitalizarDescricaoDefeito,
  normalizarCodigoDefeito,
  separarCodigoDefeito,
} from '@/modules/shopfloor/domain/defeito'
import { formatarMeta, formatarTaxa } from './taxa'
import { textoJanela, type Janela } from './janela'
import { formatarMmSs } from './tempo'

/**
 * Fuso FIXO de São Paulo. O servidor da Lightsail roda em UTC; se a hora da mensagem saísse no
 * fuso do processo, o alerta chegaria com 3 horas de diferença do relógio da fábrica.
 */
const FUSO = 'America/Sao_Paulo'

function partes(d: Date, opcoes: Intl.DateTimeFormatOptions): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, ...opcoes }).formatToParts(d)) {
    saida[p.type] = p.value
  }
  return saida
}

/** '17/09 14:05' */
export function formatarDataHoraCurta(d: Date): string {
  const p = partes(d, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}

/** '14:05' */
export function formatarHora(d: Date): string {
  const p = partes(d, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${p.hour}:${p.minute}`
}

/** 'menos de 1 min' | '35 min' | '2 h' | '1 h 20 min' */
export function formatarDuracao(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000))
  if (totalMin < 1) return 'menos de 1 min'
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

/**
 * Limite de caracteres de UMA mensagem. O Telegram aceita 4096 e o Discord 2000, e o texto é o
 * MESMO nos dois canais (decisão do 0123: quem lê no canal precisa da mesma informação de quem lê
 * no privado) — então o teto que vale é o MENOR dos dois. Passar disso não "corta" no destino: o
 * Discord RECUSA a mensagem inteira, e o alerta simplesmente não chega.
 */
export const LIMITE_MENSAGEM = 2000

/**
 * Margem guardada para o CABEÇALHO que o lembrete e a reabertura põem antes do alerta já montado
 * (`textoLembreteTipo`, `textoReabertura`). Quem monta a lista de posições é o alerta, que não sabe
 * se vai ser embrulhado depois — sem reservar isto, o alerta caberia em 2000 e o lembrete DELE
 * estouraria. 160 cobre o lembrete (~34) e a reabertura com um nome comprido de quem resolveu.
 */
const MARGEM_CABECALHO = 160

/** A ordem de produção a que o alerta se refere. Opcional: nem toda linha da fila tem as duas. */
export interface RefOp {
  pmo?: string | null
  op?: string | null
}

/** 'PMOG01/8504'; só um dos dois → só ele; nenhum → '' (quem chama omite o trecho inteiro). */
export function textoOp(d: RefOp): string {
  const pmo = (d.pmo ?? '').trim()
  const op = (d.op ?? '').trim()
  if (pmo !== '' && op !== '') return `${pmo}/${op}`
  return op !== '' ? op : pmo
}

/**
 * Sufixo das mensagens de UMA linha (normalizou, resolvido): ' · OP PMOG01/8504'. Sem PMO nem OP
 * sai vazio — nunca um ' · OP ' pendurado.
 */
function sufixoOp(d: RefOp): string {
  const t = textoOp(d)
  return t === '' ? '' : ` · OP ${t}`
}

/**
 * Linha própria da OP, logo abaixo do cabeçalho: é a primeira coisa que quem recebe no celular
 * precisa saber ("onde eu vou olhar?"), antes do número que disparou o alerta.
 *
 * Omitida quando a janela é a da OP: ali `textoJanela` JÁ diz "na OP PMO/OP" dentro da frase, e
 * repetir a mesma ordem duas vezes em duas linhas seguidas só faria a mensagem parecer errada.
 */
function linhaOp(d: RefOp & { janela: Janela }): string {
  if (d.janela.tipo === 'op') return ''
  const t = textoOp(d)
  return t === '' ? '' : `OP ${t}`
}

/** Junta as linhas de uma mensagem descartando as que saíram vazias (OP ausente, posição ausente). */
function linhas(...partes: readonly string[]): string {
  return partes.filter((l) => l !== '').join('\n')
}

/**
 * Posições (os designadores da placa: R12, C47) de um defeito, prontas para listar.
 *
 * A entrada é UMA posição por linha registrada, então a mesma posição repete quando o mesmo defeito
 * saiu nela várias vezes. O usuário pediu TODAS as posições, não só as mais frequentes — mas
 * "todas" não precisa dizer `R12` cinco vezes: agrupar em `R12 (5x)` guarda a informação inteira e
 * encurta a lista, que é o que decide se a mensagem é legível no celular.
 *
 * Ordem: o que mais aconteceu primeiro (é por onde se começa a olhar a placa), desempatando pelo
 * designador para a lista não dançar entre dois alertas da mesma ocorrência.
 *
 * `normalizarCodigoDefeito` é reaproveitado do domínio de defeito: faz exatamente o que um
 * designador precisa (apara, colapsa espaços e sobe para maiúsculas), então 'r12' e 'R12 ' contam
 * como a MESMA posição em vez de virarem dois itens da lista.
 */
export function rotulosPosicoes(posicoes: readonly (string | null | undefined)[] | null | undefined): string[] {
  const contagem = new Map<string, number>()
  for (const bruta of posicoes ?? []) {
    const p = normalizarCodigoDefeito(bruta ?? '')
    if (p === '') continue
    contagem.set(p, (contagem.get(p) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([p, n]) => (n > 1 ? `${p} (${n}x)` : p))
}

/**
 * Lista as posições dentro de um ORÇAMENTO de caracteres. Estourar o limite do Discord perderia a
 * mensagem TODA (o alerta não chegaria), então, quando não cabe, o corte é explícito — "… e mais 12
 * posições" — para quem lê saber que a lista continua e ir ver na tela. Corte silencioso aqui seria
 * pior que lista comprida: daria a entender que o defeito só saiu nas posições mostradas.
 *
 * Orçamento que não cabe nem um item com o aviso → devolve '' e a linha inteira sai da mensagem (o
 * resto do alerta vale mais que meia lista).
 */
export function listaPosicoes(itens: readonly string[], orcamento: number): string {
  if (itens.length === 0) return ''
  const tudo = itens.join(', ')
  if (tudo.length <= orcamento) return tudo
  for (let n = itens.length - 1; n >= 1; n -= 1) {
    const restantes = itens.length - n
    const texto = `${itens.slice(0, n).join(', ')}, … e mais ${restantes} ${restantes === 1 ? 'posição' : 'posições'}`
    if (texto.length <= orcamento) return texto
  }
  return ''
}

export interface DadosMensagem extends RefOp {
  posto: string
  regraNome: string
  taxaMinima: number
  aprovados: number
  reprovados: number
  janela: Janela
  em: Date
}

/** Corpo comum do alerta e do lembrete: a OP (quando há), a taxa e a regra. */
function corpo(d: DadosMensagem): string {
  return linhas(
    linhaOp(d),
    `Taxa: ${formatarTaxa(d.aprovados, d.reprovados)}% ${textoJanela(d.janela)} ` +
      `(mínimo ${formatarMeta(d.taxaMinima)}%) · ${d.aprovados} aprovados, ${d.reprovados} reprovados`,
    `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`,
  )
}

export function textoAlerta(d: DadosMensagem): string {
  return `🔴 ${d.posto} abaixo da meta\n${corpo(d)}`
}

/** Lembrete = cabeçalho com o tempo desde a abertura + o MESMO corpo do alerta. */
export function textoLembrete(d: DadosMensagem & { abertaEm: Date }): string {
  const min = Math.max(0, Math.floor((d.em.getTime() - d.abertaEm.getTime()) / 60_000))
  return `⏰ Lembrete — continua abaixo há ${min} min\n${textoAlerta(d)}`
}

/**
 * `defeito` só vem preenchido nas regras de tipo defeito. Sem ele, o texto é exatamente o de
 * antes; com ele, entra o rótulo do defeito — senão, com 2 códigos abertos no mesmo posto, "✅
 * Posto X: resolvido" não diria QUAL dos dois foi.
 */
export function textoResolvido(
  d: RefOp & { posto: string; nome: string; em: Date; defeito?: string | null },
): string {
  const alvo = d.defeito ? `Defeito ${rotuloDefeito(d.defeito)} no ${d.posto}` : d.posto
  return `✅ ${alvo}: resolvido por ${d.nome} às ${formatarHora(d.em)}${sufixoOp(d)}`
}

export function textoNormalizou(d: RefOp & {
  posto: string
  aprovados: number
  reprovados: number
  abertaEm: Date
  em: Date
}): string {
  const duracao = formatarDuracao(d.em.getTime() - d.abertaEm.getTime())
  return (
    `🟢 ${d.posto} normalizou: ${formatarTaxa(d.aprovados, d.reprovados)}% ` +
    `(ficou ${duracao} abaixo)${sufixoOp(d)}`
  )
}

export function textoTeste(nome: string): string {
  return `🔔 Teste do ShopFloor — ${nome}, os alertas do ShopFloor vão chegar aqui.`
}

export function textoVinculado(nome: string): string {
  return `✅ Conta vinculada ao ShopFloor (${nome})`
}

export const TEXTO_INSTRUCOES_TELEGRAM =
  'Para receber os alertas do ShopFloor, abra "Meu perfil" no sistema, clique em Vincular no ' +
  'Telegram e me envie o código aqui (ex.: ALERTA-7K3M). O código vale 15 minutos.'

// ---------------------------------------------------------------------------
// Tipos novos (spec 2026-09-18): tempo médio por peça e defeito repetido
// ---------------------------------------------------------------------------

/**
 * '2040 COMPONENTE FALTANDO' → '2040 (Componente Faltando)'. Em `sf_defeitos` o código JÁ É
 * "número + descrição" (o mesmo texto de `sf_registros.codigo_defeito`), então a descrição do
 * catálogo sai daqui, sem consulta. Sem número → só a descrição; sem descrição → só o número.
 */
export function rotuloDefeito(codigo: string): string {
  const { numero, descricao } = separarCodigoDefeito(codigo)
  const desc = descricao ? capitalizarDescricaoDefeito(descricao) : ''
  if (numero && desc) return `${numero} (${desc})`
  return numero || desc || codigo.trim()
}

export interface DadosMensagemTempo extends RefOp {
  posto: string
  regraNome: string
  mediaSeg: number
  limiteSeg: number
  pecas: number
  janela: Janela
  em: Date
}

export function textoAlertaTempo(d: DadosMensagemTempo): string {
  return linhas(
    `🔴 ${d.posto} lento: ${formatarMmSs(d.mediaSeg)} por peça ${textoJanela(d.janela)} ` +
      `(limite ${formatarMmSs(d.limiteSeg)}) · ${d.pecas} peças`,
    linhaOp(d),
    `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`,
  )
}

export function textoNormalizouTempo(d: RefOp & { posto: string; mediaSeg: number }): string {
  return `🟢 ${d.posto} normalizou: ${formatarMmSs(d.mediaSeg)} por peça${sufixoOp(d)}`
}

export interface DadosMensagemDefeito extends RefOp {
  posto: string
  regraNome: string
  defeito: string
  ocorrencias: number
  limite: number
  janela: Janela
  em: Date
  /** Uma posição por linha registrada (repete quando o defeito saiu duas vezes na mesma). */
  posicoes?: readonly (string | null | undefined)[] | null
}

/**
 * As POSIÇÕES entram numa linha só, separadas por vírgula, e não uma por linha: 40 posições em 40
 * linhas viram um paredão que ninguém lê no celular, enquanto em linha corrida o Telegram e o
 * Discord quebram o texto sozinhos no tamanho da tela de quem está lendo.
 *
 * O orçamento da lista é o que SOBRA do limite da mensagem depois do resto do alerta (cabeçalho, OP,
 * regra, o `\n` da própria linha e o rótulo) menos a margem do lembrete/reabertura — assim uma
 * lista comprida nunca derruba a mensagem, nem quando ela vira lembrete.
 */
export function textoAlertaDefeito(d: DadosMensagemDefeito): string {
  const cabecalho =
    `🔴 Defeito ${rotuloDefeito(d.defeito)} repetido no ${d.posto}: ${d.ocorrencias} vezes ` +
    `${textoJanela(d.janela)} (limite ${d.limite})`
  const rodape = `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  const op = linhaOp(d)

  const semPosicoes = linhas(cabecalho, op, rodape)
  const itens = rotulosPosicoes(d.posicoes)
  if (itens.length === 0) return semPosicoes

  const rotulo = itens.length === 1 ? 'Posição: ' : 'Posições: '
  const orcamento = LIMITE_MENSAGEM - MARGEM_CABECALHO - semPosicoes.length - 1 - rotulo.length
  const lista = listaPosicoes(itens, orcamento)
  if (lista === '') return semPosicoes
  return linhas(cabecalho, op, rotulo + lista, rodape)
}

export function textoNormalizouDefeito(d: RefOp & { posto: string; defeito: string }): string {
  return `🟢 Defeito ${rotuloDefeito(d.defeito)} normalizou no ${d.posto}${sufixoOp(d)}`
}

/**
 * Cabeçalho da REABERTURA (spec de 2026-09-23): a ocorrência foi dada como resolvida, a carência
 * da regra venceu e a condição continua ruim. Vem ANTES do texto normal do alerta porque, sem
 * dizer que aquilo já tinha sido encerrado, quem recebe acha que é um problema novo.
 *
 * `resolvidaEm` nulo (linha antiga da fila, sem a data) = sai sem o "há X": o resto da frase já
 * conta o que importa. Nome vazio (quem resolveu foi apagado) vira "alguém".
 */
export function textoReabertura(
  alerta: string,
  d: { nome: string; resolvidaEm: Date | null; em: Date },
): string {
  const quem = d.nome.trim() === '' ? 'alguém' : d.nome.trim()
  const quando = d.resolvidaEm ? ` há ${formatarDuracao(d.em.getTime() - d.resolvidaEm.getTime())}` : ''
  return `🔁 Reaberto — dado como resolvido por ${quem}${quando}, e continua fora do limite\n${alerta}`
}

/** Lembrete de tempo/defeito: o cabeçalho não fala em "abaixo" (um posto lento está ACIMA do limite). */
export function textoLembreteTipo(alerta: string, abertaEm: Date, em: Date): string {
  const min = Math.max(0, Math.floor((em.getTime() - abertaEm.getTime()) / 60_000))
  return `⏰ Lembrete — continua há ${min} min\n${alerta}`
}
