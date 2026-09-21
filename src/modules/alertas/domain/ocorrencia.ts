import type { EstadoOcorrencia, TipoRegra } from './tipos'
import { formatarTaxa, formatarTaxaValor } from './taxa'
import { formatarMmSs } from './tempo'
import { rotuloDefeito } from './mensagens'

/**
 * Uma linha da prévia do formulário (o valor de agora, sem gravar nada). Cada tipo usa os seus
 * campos: aprovação (aprovados/reprovados/taxa), tempo (mediaSeg/intervalos/pecas), defeito
 * (defeito/ocorrencias — `defeito` null = nenhum código chegou ao limite naquele posto).
 */
export interface PreviaPosto {
  posto: string
  defeito: string | null
  aprovados: number
  reprovados: number
  taxa: number | null
  mediaSeg: number | null
  intervalos: number
  pecas: number
  ocorrencias: number
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
  regraTipo: TipoRegra
  posto: string
  /** Só no tipo defeito: o código do defeito da ocorrência. */
  defeito: string | null
  pmo: string | null
  op: string | null
  estado: EstadoOcorrencia
  /** Só no tipo aprovação (colunas antigas). */
  taxaAbertura: number | null
  taxaUltima: number | null
  /** Valor medido: taxa (%), média (segundos) ou contagem, conforme o tipo. */
  valorAbertura: number | null
  valorUltimo: number | null
  amostras: number | null
  aprovados: number
  reprovados: number
  abertaEm: string
  resolvidaPorNome: string
  resolvidaEm: string | null
  normalizadaEm: string | null
  enviosOk: number
  enviosFalha: number
}

/** Valor medido na régua do tipo: '88,8%', '3:00/peça', '4 vezes'. */
export function formatarValorOcorrencia(tipo: TipoRegra, valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  if (tipo === 'tempo') return `${formatarMmSs(valor)}/peça`
  if (tipo === 'defeito') return valor === 1 ? '1 vez' : `${valor} vezes`
  return `${formatarTaxaValor(valor)}%`
}

/** Uma linha da prévia, no texto da tela. `limiteOcorrencias` só importa no tipo defeito. */
export function textoPreviaPosto(tipo: TipoRegra, p: PreviaPosto, limiteOcorrencias: number | null): string {
  if (tipo === 'tempo') {
    if (p.avaliavel && p.mediaSeg !== null) {
      return `${p.posto}: ${formatarMmSs(p.mediaSeg)} por peça (${p.intervalos} intervalos, ${p.pecas} peças)`
    }
    // Avaliável agora exige o mínimo de PEÇAS (bipes), não de intervalos válidos.
    return `${p.posto}: peças insuficientes na janela (${p.pecas})`
  }
  if (tipo === 'defeito') {
    if (p.defeito === null) return `${p.posto}: nenhum defeito repetido ${limiteOcorrencias ?? '—'} vezes ou mais`
    return `${p.posto}: ${rotuloDefeito(p.defeito)} — ${p.ocorrencias} vezes`
  }
  if (p.avaliavel) {
    return `${p.posto}: ${formatarTaxa(p.aprovados, p.reprovados)}% (${p.aprovados} aprovados, ${p.reprovados} reprovados)`
  }
  return `${p.posto}: bipes insuficientes na janela (${p.aprovados + p.reprovados})`
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
