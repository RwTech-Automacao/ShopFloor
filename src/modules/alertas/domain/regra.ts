import {
  CANAIS,
  NOME_CANAL,
  ehJanelaTipo,
  ehTipoRegra,
  type Canal,
  type JanelaTipo,
  type TipoRegra,
} from './tipos'
import { formatarMeta } from './taxa'
import { NOME_MODULO_ALERTA, ehModuloAlerta, tipoPertenceAoModulo, type ModuloAlerta } from './modulo'
import { lerHhMm, validarIntervalos, type Intervalo } from './intervalos'
import { formatarMmSs, lerMmSs } from './tempo'
import { HORA_RESUMO_MAX, HORA_RESUMO_MIN } from './resumo'
import { resumoJanela } from './janela'
import { JANELA_EMB, LIMITE_EMB } from './emb'

/** O que vem do formulário (tudo pode chegar como texto). Campos de outro tipo são ignorados. */
export interface EntradaRegra {
  /** Ausente = 'shopfloor' (chamadas de antes de a regra ter módulo). */
  modulo?: string
  /** Ausente = 'aprovacao' (chamadas de antes dos tipos). */
  tipo?: string
  nome: string
  postos: string[]
  taxaMinima: string | number
  janelaTipo: string
  janelaValor: string | number | null
  /** Aprovação e tempo: mínimo de bipes (peças). Defeito: ignorado. */
  minimoBipes: string | number
  /** Tempo médio: 'm:ss' (ex.: '2:00'). */
  limiteTempo?: string
  /** Defeito repetido: N. */
  limiteOcorrencias?: string | number | null
  /** Tempo médio: minutos. */
  pausaMaxMin?: string | number | null
  lembreteMin: string | number | null
  /** Os canais da CONVERSA PRIVADA (Telegram e/ou Discord). Só valem com `avisarPessoas`. */
  canais: string[]
  /** Os RESPONSÁVEIS: quem responde pelo alerta e pode encerrá-lo. */
  destinatarios: string[]
  /** Ausente = true (chamadas de antes do canal). Avisa na conversa privada de cada responsável. */
  avisarPessoas?: boolean
  /** Ausente = false. Avisa no canal do Discord do sistema (DISCORD_CANAL_ID). */
  avisarCanal?: boolean
  /** Vazio = todas as PMOs. */
  pmos?: string[]
  /** Janela `intervalos`: os horários do turno ({ inicio, fim } 'HH:MM'). Nas outras, é ignorado. */
  intervalos?: unknown
  /** Resumo diário: a hora do envio ('HH:MM', hora da fábrica). Nos outros tipos, é ignorado. */
  horaResumo?: string | null
  /** Parado no Almoxarifado: horas de expediente sem entrada (inteiro de 1 a 72). Nos outros, é ignorado. */
  limiteHoras?: string | number | null
  ativa: boolean
}

/** A regra já conferida, pronta para o banco. Campo que não é do tipo = null. */
export interface RegraValida {
  modulo: ModuloAlerta
  tipo: TipoRegra
  nome: string
  postos: string[]
  taxaMinima: number | null
  janelaTipo: JanelaTipo
  janelaValor: number | null
  minimoBipes: number | null
  limiteTempoSeg: number | null
  limiteOcorrencias: number | null
  pausaMaxMin: number | null
  lembreteMin: number | null
  /** Janela `intervalos`: os horários do turno, ordenados. Vazio nas outras janelas. */
  intervalos: Intervalo[]
  /** Resumo diário: a hora do envio ('HH:MM'). Nos outros tipos, null. */
  horaResumo: string | null
  /** Parado no Almoxarifado: o limite em horas de expediente. Nos outros tipos, null. */
  limiteHoras: number | null
  canais: Canal[]
  destinatarios: string[]
  avisarPessoas: boolean
  avisarCanal: boolean
  pmos: string[]
  ativa: boolean
}

export interface RegraAlerta extends RegraValida {
  id: string
  atualizadoEm: string
}

export interface DestinatarioDisponivel {
  usuarioId: string
  nome: string
  /** O endereço de login. Mostrado na tela; NÃO é o "tem canal" (ver `emailOk`). */
  email: string
  telegram: boolean
  discord: boolean
  /** O endereço de login serve para enviar (não está em branco) — o "tem canal" do e-mail. */
  emailOk: boolean
}

/** O que a prévia do formulário precisa (nome/canais/destinatários ainda podem faltar). */
export interface EntradaPrevia {
  tipo?: string
  postos: string[]
  janelaTipo: string
  janelaValor: string | number | null
  minimoBipes: string | number
  pausaMaxMin?: string | number | null
  limiteOcorrencias?: string | number | null
  pmos?: string[]
  intervalos?: unknown
}

export interface PreviaValida {
  tipo: TipoRegra
  postos: string[]
  janelaTipo: JanelaTipo
  janelaValor: number | null
  minimoBipes: number | null
  pausaMaxMin: number | null
  limiteOcorrencias: number | null
  pmos: string[]
  intervalos: Intervalo[]
}

/** Teto da janela `tempo` (7 dias), igual ao check da 0113. */
export const JANELA_TEMPO_MAX_MIN = 10080

/** Padrões da spec de 2026-09-17 (taxa de aprovação). */
export const PADROES_REGRA = { taxaMinima: 90, janelaTempo: 60, janelaBipes: 50, minimoBipes: 20 }

/** Padrões dos tipos novos (spec de 2026-09-18). */
export const PADROES_TIPO = {
  tempo: { limiteTempo: '2:00', janelaTempo: 60, minimoBipes: 10, pausaMaxMin: 30 },
  defeito: { limiteOcorrencias: 5, janelaTempo: 60 },
} as const

/** "Ignorar pausas acima de" é OPCIONAL: quando preenchida, aceita de 1 a 240 minutos (check da
 * 0115); vazia = não descarta nenhum intervalo (todas as pausas entram na média). */
export const PAUSA_MAX_MIN = { min: 1, max: 240 } as const

/** Teto e padrão do limite do parado (check da 0167: 1..72). */
export const LIMITE_HORAS_MAX = 72
export const LIMITE_HORAS_PADRAO = 2

const MSG_LIMITE_HORAS = `Informe o limite em horas (de 1 a ${LIMITE_HORAS_MAX}).`
const JANELA_PARADO = 'Itens prontos sem entrada no Almoxarifado'
const MSG_RESUMO_CAMPO = 'O resumo diário não usa este campo.'
const MSG_EMB_CAMPO = 'O aviso de fim de EMB não usa este campo.'
const MSG_RESUMO_HORA =
  'A hora do resumo deve ficar entre 06:00 e 19:00 (fora disso o banco está desligado e o relatório não sairia).'

const MSG_RESUMO_APOS_TURNO =
  'O resumo do dia tem de sair depois que o último intervalo fecha. Antes disso ele sairia com os números do começo do turno e o relatório do dia inteiro se perderia.'

const RE_DECIMAL = /^\d{1,3}([.,]\d{1,2})?$/

type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string }

function erro(mensagem: string): { ok: false; erro: string } {
  return { ok: false, erro: mensagem }
}

function textoLimpo(v: string | number | null | undefined): string {
  return String(v ?? '').trim()
}

/** Número inteiro ou null (vazio). NaN quando o texto não é número. */
function inteiro(v: string | number | null | undefined): number | null {
  const s = textoLimpo(v).replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isInteger(n) ? n : Number.NaN
}

// Payload malformado (ex.: JSON de terceiro, campo faltando) pode chegar sem ser array — trata
// como lista vazia em vez de estourar `.map`/`.includes`, e a regra de "pelo menos 1" recusa.
function unicos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return []
  return [
    ...new Set(
      lista
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter((x) => x !== ''),
    ),
  ]
}

/**
 * O que a validação precisa saber do AMBIENTE (o domínio não lê env: quem chama informa).
 * Campo ausente = não restringe nada, para as chamadas que não passam ambiente.
 */
export interface AmbienteRegra {
  /** O canal do Discord do sistema está pronto (token do bot + DISCORD_CANAL_ID)? */
  canalConfigurado?: boolean
  /**
   * Quais canais da mensagem direta este ambiente tem (Telegram, Discord, E-mail). Ausente = não
   * confere. Quem SALVA a regra informa o mapa real: o servidor o calcula, nunca o cliente.
   */
  canaisConfigurados?: Record<Canal, boolean>
}

export function validarRegra(e: EntradaRegra, ambiente: AmbienteRegra = {}): Resultado<RegraValida> {
  const moduloBruto =
    e.modulo === undefined || e.modulo === null || e.modulo === '' ? 'shopfloor' : e.modulo
  if (!ehModuloAlerta(moduloBruto)) return erro('Escolha o módulo da regra.')
  const modulo: ModuloAlerta = moduloBruto

  const tipoBruto = e.tipo === undefined || e.tipo === null || e.tipo === '' ? 'aprovacao' : e.tipo
  if (!ehTipoRegra(tipoBruto)) return erro('Escolha o tipo da regra.')
  const tipo: TipoRegra = tipoBruto

  // O tipo tem de ser um dos que o módulo oferece. Sem isto, o cliente mandaria uma regra de taxa
  // de aprovação para o Recebimento — e ela mediria postos que o Recebimento não tem.
  if (!tipoPertenceAoModulo(tipo, modulo)) {
    return erro(`Este tipo de regra não existe no ${NOME_MODULO_ALERTA[modulo]}.`)
  }

  const nome = textoLimpo(e.nome).replace(/\s+/g, ' ')
  if (nome === '') return erro('Informe o nome da regra.')

  // O fim de EMB não tem posto: o gatilho é a EMB fechar, e EMB não é posto. Os outros tipos
  // continuam exigindo pelo menos um. O banco cobra o mesmo (`alerta_regras_postos_por_tipo`, 0150).
  const postos = tipo === 'emb' ? [] : unicos(e.postos)
  if (tipo !== 'emb' && postos.length === 0) return erro('Escolha pelo menos 1 posto.')

  // Fim de EMB: caminho próprio até os destinatários, como o resumo diário. Não usa taxa, janela,
  // bipes, lembrete, limites nem hora, e RECUSA o campo que não é dele em vez de ignorá-lo em
  // silêncio. A janela SAI como 'op' com valor nulo, seja o que o formulário mandar — é valor de
  // fachada (o 'op' é o único janela_tipo que o banco aceita com valor nulo sem mexer nos dois
  // checks de janela_valor), e a coluna "Janela" da lista mostra `JANELA_EMB`, nunca este valor.
  if (tipo === 'emb') {
    const naoUsados = [
      e.taxaMinima, e.janelaValor, e.minimoBipes, e.lembreteMin,
      e.limiteTempo, e.limiteOcorrencias, e.pausaMaxMin, e.horaResumo,
    ]
    if (naoUsados.some((v) => textoLimpo(v) !== '')) return erro(MSG_EMB_CAMPO)
  }

  // Resumo diário: segue um caminho próprio até os destinatários (não usa taxa, janela em minutos,
  // bipes, lembrete nem limites) e RECUSA o campo que não é dele em vez de ignorá-lo em silêncio.
  let horaResumo: string | null = null
  let intervalosResumo: Intervalo[] = []
  if (tipo === 'resumo') {
    const naoUsados = [e.taxaMinima, e.janelaValor, e.minimoBipes, e.lembreteMin, e.limiteTempo, e.limiteOcorrencias, e.pausaMaxMin]
    if (naoUsados.some((v) => textoLimpo(v) !== '')) return erro(MSG_RESUMO_CAMPO)
    // Sem passo: o resumo usa os intervalos só para saber o que é "o dia" de cada posto.
    const ri = validarIntervalos(e.intervalos, null)
    if (!ri.ok) return erro(ri.erro)
    intervalosResumo = ri.valor
    const hora = lerHhMm(textoLimpo(e.horaResumo))
    if (hora === null) return erro('Informe a hora do resumo no formato HH:MM (ex.: 18:00).')
    // A fronteira mora em `resumo.ts`; aqui só se compara, nunca se reescreve o número.
    if (hora < (lerHhMm(HORA_RESUMO_MIN) as number) || hora > (lerHhMm(HORA_RESUMO_MAX) as number)) {
      return erro(MSG_RESUMO_HORA)
    }
    // O fim do último intervalo é o MAIOR fim da lista, não o do último item do array.
    const fimDoTurno = Math.max(...intervalosResumo.map((i) => lerHhMm(i.fim) as number))
    if (hora < fimDoTurno) return erro(MSG_RESUMO_APOS_TURNO)
    horaResumo = textoLimpo(e.horaResumo)
  }

  // Parado no Almoxarifado: também sem janela (sai 'op' de fachada, como o fim de EMB; o banco exige
  // janela_valor nulo). Os campos de medida dos outros tipos são IGNORADOS e saem nulos. Os turnos
  // são opcionais: sem nenhum, o relógio é corrido; com algum, só as horas de expediente contam.
  let limiteHoras: number | null = null
  let intervalosParado: Intervalo[] = []
  if (tipo === 'parado') {
    const h = inteiro(e.limiteHoras)
    if (h === null || Number.isNaN(h) || h < 1 || h > LIMITE_HORAS_MAX) return erro(MSG_LIMITE_HORAS)
    limiteHoras = h
    const bruto = e.intervalos
    const semTurno = bruto === undefined || bruto === null || (Array.isArray(bruto) && bruto.length === 0)
    if (!semTurno) {
      const ri = validarIntervalos(bruto, null)
      if (!ri.ok) return erro(ri.erro)
      intervalosParado = ri.valor
    }
  }

  let taxaMinima: number | null = null
  if (tipo === 'aprovacao') {
    const taxaTexto = textoLimpo(e.taxaMinima)
    const taxa = Number(taxaTexto.replace(',', '.'))
    if (taxaTexto === '' || !Number.isFinite(taxa) || taxa < 0 || taxa > 100) {
      return erro('A taxa mínima deve ficar entre 0 e 100.')
    }
    // Conferido no TEXTO: em ponto flutuante 90,125 "arredonda" e passaria escondido.
    if (!RE_DECIMAL.test(taxaTexto)) return erro('A taxa mínima aceita até 2 casas decimais.')
    taxaMinima = taxa
  }

  // O parado não pergunta a janela: ela sai 'op' de fachada, seja o que o formulário mandar.
  if (tipo !== 'resumo' && tipo !== 'emb' && tipo !== 'parado' && !ehJanelaTipo(e.janelaTipo)) {
    return erro('Escolha a janela da regra.')
  }
  // O resumo sai SEMPRE como 'intervalos' (ele usa os intervalos) e o fim de EMB SEMPRE como 'op'
  // (valor de fachada, ver acima), seja o que o formulário mandar.
  const janelaTipo: JanelaTipo =
    tipo === 'resumo'
      ? 'intervalos'
      : tipo === 'emb' || tipo === 'parado'
        ? 'op'
        : (e.janelaTipo as JanelaTipo)
  if (tipo !== 'aprovacao' && tipo !== 'resumo' && janelaTipo === 'intervalos') {
    return erro('Só a taxa de aprovação usa a janela por blocos de turno.')
  }
  if (tipo === 'tempo' && janelaTipo === 'bipes') {
    return erro('Tempo médio por peça usa a janela por minutos ou a OP em andamento.')
  }
  if (tipo === 'defeito' && janelaTipo !== 'tempo') return erro('Defeito repetido usa só a janela por minutos.')

  let janelaValor: number | null = null
  // O `tipo !== 'emb'` é redundante hoje (a janela dele é 'op'), e está escrito para o dia em que
  // o valor de fachada mudar: o fim de EMB não tem janela em grandeza nenhuma.
  if (tipo !== 'resumo' && tipo !== 'emb' && tipo !== 'parado' && janelaTipo !== 'op') {
    const v = inteiro(e.janelaValor)
    if (v === null || Number.isNaN(v) || v <= 0) {
      if (janelaTipo === 'intervalos') return erro('Informe o passo do bloco em minutos.')
      return erro(janelaTipo === 'tempo' ? 'Informe quantos minutos a janela olha.' : 'Informe quantos bipes a janela olha.')
    }
    if (janelaTipo === 'tempo' && v > JANELA_TEMPO_MAX_MIN) {
      return erro('A janela de tempo pode ter no máximo 7 dias (10080 minutos).')
    }
    janelaValor = v
  }

  // Janela por blocos: `janelaValor` é o PASSO em minutos. As faixas do passo e os horários são
  // conferidas por `validarIntervalos`, e o erro dela sobe como erro da regra, sem reescrever.
  let intervalos: Intervalo[] = tipo === 'parado' ? intervalosParado : intervalosResumo
  if (tipo !== 'resumo' && tipo !== 'emb' && tipo !== 'parado' && janelaTipo === 'intervalos') {
    const ri = validarIntervalos(e.intervalos, janelaValor)
    if (!ri.ok) return erro(ri.erro)
    intervalos = ri.valor
  }

  let minimoBipes: number | null = null
  if (tipo === 'aprovacao' || tipo === 'tempo') {
    const m = inteiro(e.minimoBipes)
    if (m === null || Number.isNaN(m) || m <= 0) {
      return erro('O mínimo de bipes deve ser um número inteiro maior que zero.')
    }
    minimoBipes = m
  }
  // Janela de 10 bipes com mínimo de 20 NUNCA decidiria nada — melhor recusar do que ficar muda.
  // (Só na janela `bipes`: na janela `intervalos` o valor é minutos, outra grandeza.)
  if (tipo === 'aprovacao' && janelaTipo === 'bipes' && janelaValor !== null && minimoBipes !== null && janelaValor < minimoBipes) {
    return erro('A janela de bipes precisa ser maior ou igual ao mínimo de bipes.')
  }

  let limiteTempoSeg: number | null = null
  let pausaMaxMin: number | null = null
  if (tipo === 'tempo') {
    limiteTempoSeg = lerMmSs(textoLimpo(e.limiteTempo))
    if (limiteTempoSeg === null) return erro('Informe o tempo máximo por peça em mm:ss (de 0:01 a 60:00).')
    // Campo OPCIONAL: vazio = não descarta nenhum intervalo (todas as pausas entram na média).
    const p = inteiro(e.pausaMaxMin)
    if (p !== null) {
      if (Number.isNaN(p) || p < PAUSA_MAX_MIN.min || p > PAUSA_MAX_MIN.max) {
        return erro('Ignorar pausas acima de: informe um número inteiro de 1 a 240 minutos.')
      }
      pausaMaxMin = p
      // Intervalo maior que a pausa sai da média: com limite >= pausa, a média nunca passa do limite.
      // Só se aplica quando a pausa está preenchida (vazia = nenhum intervalo é descartado).
      if (limiteTempoSeg >= pausaMaxMin * 60) {
        return erro('O limite de tempo precisa ser menor que a pausa ignorada (senão a regra nunca dispara).')
      }
    }
  }

  let limiteOcorrencias: number | null = null
  if (tipo === 'defeito') {
    const n = inteiro(e.limiteOcorrencias)
    if (n === null || Number.isNaN(n) || n < 2) {
      return erro('Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).')
    }
    limiteOcorrencias = n
  }

  // Na janela por blocos quem comanda a insistência é o bloco, não os minutos: o lembrete é
  // ignorado (sai null), mesmo preenchido.
  let lembrete: number | null = null
  if (tipo !== 'resumo' && tipo !== 'emb' && janelaTipo !== 'intervalos') {
    lembrete = inteiro(e.lembreteMin)
    if (lembrete !== null && (Number.isNaN(lembrete) || lembrete <= 0)) {
      return erro('O lembrete deve ser um número inteiro de minutos (ou vazio).')
    }
  }

  const canaisEntrada = Array.isArray(e.canais) ? e.canais : []
  const canaisPrivado = CANAIS.filter((c) => canaisEntrada.includes(c))

  const destinatarios = unicos(e.destinatarios)
  // Continua obrigatório: são os RESPONSÁVEIS, e é deles que sai o direito de encerrar. Uma regra
  // que avisasse só no canal sem responsável nenhum deixaria o botão "Resolvido" sem quem apertar.
  if (destinatarios.length === 0) return erro('Escolha pelo menos 1 responsável.')

  const avisarPessoas = e.avisarPessoas ?? true
  const avisarCanal = e.avisarCanal ?? false
  if (!avisarPessoas && !avisarCanal) {
    return erro('Escolha avisar por mensagem direta, no canal do Discord, ou os dois.')
  }
  if (avisarPessoas && canaisPrivado.length === 0) {
    return erro('Marque pelo menos 1 canal da mensagem direta: Telegram, Discord ou E-mail.')
  }
  // Regra que avisaria SÓ no canal, num ambiente sem canal, some sem deixar rastro: a ocorrência
  // abre, ninguém é avisado, e o lembrete também não salva porque a abertura já renovou o
  // `ultimo_envio_em`. Avisar no canal E nas pessoas continua valendo — as pessoas são avisadas de
  // qualquer jeito, e a mensagem do canal é o que se perde.
  if (avisarCanal && !avisarPessoas && ambiente.canalConfigurado === false) {
    return erro(
      'O canal do Discord não está configurado neste ambiente: marque também a mensagem direta ao responsável, ou peça ao TI para configurar o canal.',
    )
  }

  // Regra cujos canais marcados estão TODOS sem credencial neste ambiente é um beco sem saída: o
  // banco enfileira, ninguém entrega, a mensagem vence em 24 h e (no fim de EMB) a marca "já
  // avisada" impede um segundo aviso. Basta UM canal marcado e configurado para salvar.
  if (avisarPessoas && ambiente.canaisConfigurados) {
    const mapa = ambiente.canaisConfigurados
    if (canaisPrivado.every((c) => !mapa[c])) {
      return erro(
        canaisPrivado.length === 1
          ? `O ${NOME_CANAL[canaisPrivado[0]!]} não está configurado neste ambiente; marque outro canal.`
          : `Nenhum dos canais marcados (${canaisPrivado.map((c) => NOME_CANAL[c]).join(', ')}) está configurado neste ambiente; marque outro canal.`,
      )
    }
  }

  /**
   * O que vai para `alerta_regras.canais`: os canais da conversa privada. Com a conversa privada
   * DESLIGADA, entra `['discord']` só para satisfazer o `cardinality(canais) > 0` da 0113 — não
   * muda nada, porque o fan-out de pessoa está desligado por `avisar_pessoas = false`. É isso que
   * deixa o gestor marcar só "No canal do Discord" sem entender amarração nenhuma.
   */
  const canais: Canal[] = avisarPessoas ? [...canaisPrivado] : ['discord']

  return {
    ok: true,
    valor: {
      modulo,
      tipo,
      nome,
      postos,
      taxaMinima,
      janelaTipo,
      janelaValor,
      minimoBipes,
      limiteTempoSeg,
      limiteOcorrencias,
      pausaMaxMin,
      lembreteMin: lembrete,
      intervalos,
      horaResumo,
      limiteHoras,
      canais,
      destinatarios,
      avisarPessoas,
      avisarCanal,
      // O fim de EMB não filtra por PMO: o gatilho é a EMB, e o check da 0150 exige `pmos` vazio.
      pmos: tipo === 'emb' ? [] : unicos(e.pmos),
      ativa: e.ativa,
    },
  }
}

/** A prévia só precisa de tipo + postos + janela + parâmetros de cálculo + PMOs. */
export function validarPrevia(e: EntradaPrevia): Resultado<PreviaValida> {
  const r = validarRegra({
    tipo: e.tipo,
    nome: 'previa',
    postos: e.postos,
    taxaMinima: 100,
    janelaTipo: e.janelaTipo,
    janelaValor: e.janelaValor,
    minimoBipes: e.minimoBipes,
    // O menor limite possível: a prévia não tem limite, e com a menor pausa (1 min) o check
    // "limite < pausa" continua passando.
    limiteTempo: '0:01',
    pausaMaxMin: e.pausaMaxMin,
    limiteOcorrencias: e.limiteOcorrencias,
    lembreteMin: null,
    canais: ['telegram'],
    destinatarios: ['previa'],
    pmos: e.pmos,
    intervalos: e.intervalos,
    ativa: true,
  })
  if (!r.ok) return r
  const v = r.valor
  return {
    ok: true,
    valor: {
      tipo: v.tipo,
      postos: v.postos,
      janelaTipo: v.janelaTipo,
      janelaValor: v.janelaValor,
      minimoBipes: v.minimoBipes,
      pausaMaxMin: v.pausaMaxMin,
      limiteOcorrencias: v.limiteOcorrencias,
      pmos: v.pmos,
      intervalos: v.intervalos,
    },
  }
}

/** Coluna "Limite" da lista de regras: '≥ 90%', '≤ 2:00/peça', '≥ 5 vezes'. */
export function resumoLimite(
  r: Pick<RegraValida, 'tipo' | 'taxaMinima' | 'limiteTempoSeg' | 'limiteOcorrencias'> & {
    limiteHoras?: number | null
  },
): string {
  // O fim de EMB não tem limite: tem gatilho. Mostrar '—' deixaria a coluna parecendo defeito.
  if (r.tipo === 'emb') return LIMITE_EMB
  if (r.tipo === 'parado') return r.limiteHoras == null ? '—' : `Parado há mais de ${r.limiteHoras} h de expediente`
  if (r.tipo === 'tempo') return r.limiteTempoSeg === null ? '—' : `≤ ${formatarMmSs(r.limiteTempoSeg)}/peça`
  if (r.tipo === 'defeito') return r.limiteOcorrencias === null ? '—' : `≥ ${r.limiteOcorrencias} vezes`
  return r.taxaMinima === null ? '—' : `≥ ${formatarMeta(r.taxaMinima)}%`
}

/**
 * Coluna "Janela" da lista. O resumo diário guarda `janelaTipo = 'intervalos'` só para saber o que é
 * "o dia" de cada posto: mostrar "Blocos de 1h" diria uma janela que ele não tem. Ele mostra a hora.
 */
export function resumoJanelaRegra(
  r: Pick<RegraValida, 'tipo' | 'janelaTipo' | 'janelaValor' | 'horaResumo'>,
): string {
  // ⚠️ O fim de EMB guarda janela_tipo = 'op' por FACHADA (ver validarRegra): mostrar "na OP em
  // andamento" diria uma janela que ele não tem — o mesmo motivo que fez o resumo mostrar a hora
  // em vez de "Blocos de 1h".
  if (r.tipo === 'emb') return JANELA_EMB
  // Mesma fachada do fim de EMB: o 'op' guardado não é uma janela de verdade.
  if (r.tipo === 'parado') return JANELA_PARADO
  if (r.tipo === 'resumo') return r.horaResumo ? `Dia inteiro, às ${r.horaResumo}` : '—'
  return resumoJanela({ tipo: r.janelaTipo, valor: r.janelaValor })
}

/** Coluna "PMOs": nenhuma = todas. */
export function resumoPmos(pmos: string[]): string {
  return pmos.length === 0 ? 'Todas' : pmos.join(', ')
}

/**
 * O "tem canal" de cada canal. O mapa é EXPLÍCITO, e não `d[canal]`: com 'email' em `Canal`, o
 * `d['email']` leria o ENDEREÇO (uma string) como se fosse o booleano — endereço preenchido daria
 * "tem canal" mesmo quando não serve.
 */
const TEM_CANAL: Record<Canal, (d: DestinatarioDisponivel) => boolean> = {
  telegram: (d) => d.telegram,
  discord: (d) => d.discord,
  email: (d) => d.emailOk,
}

/** Avisos do diálogo: quem está escolhido mas não recebe por algum canal marcado. */
export function destinatariosSemCanal(
  disponiveis: DestinatarioDisponivel[],
  selecionados: string[],
  canais: Canal[],
): string[] {
  return disponiveis
    .filter((d) => selecionados.includes(d.usuarioId))
    .flatMap((d) => canais.filter((c) => !TEM_CANAL[c](d)).map((c) => `${d.nome} sem ${NOME_CANAL[c]}`))
}
