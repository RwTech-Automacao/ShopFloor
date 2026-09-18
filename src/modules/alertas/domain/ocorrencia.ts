import type { EstadoOcorrencia } from './tipos'

/** Uma linha da prévia do formulário (taxa de agora, sem gravar nada). */
export interface PreviaPosto {
  posto: string
  aprovados: number
  reprovados: number
  taxa: number | null
  avaliavel: boolean
  pmo: string | null
  op: string | null
}

export interface FiltroOcorrencias {
  /** 'YYYY-MM-DD' */
  de: string
  /** 'YYYY-MM-DD' */
  ate: string
  /** '' = todos os estados */
  estado: '' | EstadoOcorrencia
}

export interface OcorrenciaLinha {
  id: string
  regraId: string
  regraNome: string
  posto: string
  pmo: string | null
  op: string | null
  estado: EstadoOcorrencia
  taxaAbertura: number
  taxaUltima: number
  aprovados: number
  reprovados: number
  abertaEm: string
  resolvidaPorNome: string
  resolvidaEm: string | null
  normalizadaEm: string | null
  enviosOk: number
  enviosFalha: number
}

const FUSO = 'America/Sao_Paulo'
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/

/** Dia 'YYYY-MM-DD' no fuso da fábrica (o servidor roda em UTC). */
export function dataIsoSaoPaulo(d: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}

/**
 * Converte os dois dias do filtro no intervalo que o banco recebe. O deslocamento é fixo em -03:00:
 * o Brasil não tem horário de verão desde 2019.
 */
export function periodoOcorrencias(de: string, ate: string): { de: string; ate: string } | null {
  if (!RE_DIA.test(de) || !RE_DIA.test(ate) || de > ate) return null
  return { de: `${de}T00:00:00-03:00`, ate: `${ate}T23:59:59.999-03:00` }
}

/** Filtro inicial da aba Ocorrências: os últimos 7 dias. */
export function filtroOcorrenciasPadrao(hoje: Date): FiltroOcorrencias {
  const seteDias = new Date(hoje.getTime() - 6 * 24 * 60 * 60 * 1000)
  return { de: dataIsoSaoPaulo(seteDias), ate: dataIsoSaoPaulo(hoje), estado: '' }
}
