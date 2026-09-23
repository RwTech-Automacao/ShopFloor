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
import { formatarMmSs, lerMmSs } from './tempo'

/** O que vem do formulário (tudo pode chegar como texto). Campos de outro tipo são ignorados. */
export interface EntradaRegra {
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
  canais: string[]
  /** Os RESPONSÁVEIS: quem responde pelo alerta e pode encerrá-lo. */
  destinatarios: string[]
  /** Ausente = true (chamadas de antes do canal). Avisa na conversa privada de cada responsável. */
  avisarPessoas?: boolean
  /** Ausente = false. Avisa no canal do Discord do sistema (DISCORD_CANAL_ID). */
  avisarCanal?: boolean
  /** Vazio = todas as PMOs. */
  pmos?: string[]
  ativa: boolean
}

/** A regra já conferida, pronta para o banco. Campo que não é do tipo = null. */
export interface RegraValida {
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
  email: string
  telegram: boolean
  discord: boolean
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

export function validarRegra(e: EntradaRegra): Resultado<RegraValida> {
  const tipoBruto = e.tipo === undefined || e.tipo === null || e.tipo === '' ? 'aprovacao' : e.tipo
  if (!ehTipoRegra(tipoBruto)) return erro('Escolha o tipo da regra.')
  const tipo: TipoRegra = tipoBruto

  const nome = textoLimpo(e.nome).replace(/\s+/g, ' ')
  if (nome === '') return erro('Informe o nome da regra.')

  const postos = unicos(e.postos)
  if (postos.length === 0) return erro('Escolha pelo menos 1 posto.')

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

  if (!ehJanelaTipo(e.janelaTipo)) return erro('Escolha a janela da regra.')
  const janelaTipo: JanelaTipo = e.janelaTipo
  if (tipo === 'tempo' && janelaTipo === 'bipes') {
    return erro('Tempo médio por peça usa a janela por minutos ou a OP em andamento.')
  }
  if (tipo === 'defeito' && janelaTipo !== 'tempo') return erro('Defeito repetido usa só a janela por minutos.')

  let janelaValor: number | null = null
  if (janelaTipo !== 'op') {
    const v = inteiro(e.janelaValor)
    if (v === null || Number.isNaN(v) || v <= 0) {
      return erro(janelaTipo === 'tempo' ? 'Informe quantos minutos a janela olha.' : 'Informe quantos bipes a janela olha.')
    }
    if (janelaTipo === 'tempo' && v > JANELA_TEMPO_MAX_MIN) {
      return erro('A janela de tempo pode ter no máximo 7 dias (10080 minutos).')
    }
    janelaValor = v
  }

  let minimoBipes: number | null = null
  if (tipo !== 'defeito') {
    const m = inteiro(e.minimoBipes)
    if (m === null || Number.isNaN(m) || m <= 0) {
      return erro('O mínimo de bipes deve ser um número inteiro maior que zero.')
    }
    minimoBipes = m
  }
  // Janela de 10 bipes com mínimo de 20 NUNCA decidiria nada — melhor recusar do que ficar muda.
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

  const lembrete = inteiro(e.lembreteMin)
  if (lembrete !== null && (Number.isNaN(lembrete) || lembrete <= 0)) {
    return erro('O lembrete deve ser um número inteiro de minutos (ou vazio).')
  }

  const canaisEntrada = Array.isArray(e.canais) ? e.canais : []
  const canais = CANAIS.filter((c) => canaisEntrada.includes(c))
  if (canais.length === 0) return erro('Escolha pelo menos 1 canal.')

  const destinatarios = unicos(e.destinatarios)
  // Continua obrigatório: são os RESPONSÁVEIS, e é deles que sai o direito de encerrar. Uma regra
  // que avisasse só no canal sem responsável nenhum deixaria o botão "Resolvido" sem quem apertar.
  if (destinatarios.length === 0) return erro('Escolha pelo menos 1 responsável.')

  const avisarPessoas = e.avisarPessoas ?? true
  const avisarCanal = e.avisarCanal ?? false
  if (avisarCanal && !canais.includes('discord')) {
    return erro('Avisar no canal exige o canal Discord marcado (o canal é do Discord).')
  }
  if (!avisarPessoas && !avisarCanal) {
    return erro('Escolha avisar os responsáveis, o canal do Discord, ou os dois.')
  }

  return {
    ok: true,
    valor: {
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
      canais: [...canais],
      destinatarios,
      avisarPessoas,
      avisarCanal,
      pmos: unicos(e.pmos),
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
    },
  }
}

/** Coluna "Limite" da lista de regras: '≥ 90%', '≤ 2:00/peça', '≥ 5 vezes'. */
export function resumoLimite(
  r: Pick<RegraValida, 'tipo' | 'taxaMinima' | 'limiteTempoSeg' | 'limiteOcorrencias'>,
): string {
  if (r.tipo === 'tempo') return r.limiteTempoSeg === null ? '—' : `≤ ${formatarMmSs(r.limiteTempoSeg)}/peça`
  if (r.tipo === 'defeito') return r.limiteOcorrencias === null ? '—' : `≥ ${r.limiteOcorrencias} vezes`
  return r.taxaMinima === null ? '—' : `≥ ${formatarMeta(r.taxaMinima)}%`
}

/** Coluna "PMOs": nenhuma = todas. */
export function resumoPmos(pmos: string[]): string {
  return pmos.length === 0 ? 'Todas' : pmos.join(', ')
}

/** Avisos do diálogo: quem está escolhido mas não recebe por algum canal marcado. */
export function destinatariosSemCanal(
  disponiveis: DestinatarioDisponivel[],
  selecionados: string[],
  canais: Canal[],
): string[] {
  return disponiveis
    .filter((d) => selecionados.includes(d.usuarioId))
    .flatMap((d) => canais.filter((c) => !d[c]).map((c) => `${d.nome} sem ${NOME_CANAL[c]}`))
}
