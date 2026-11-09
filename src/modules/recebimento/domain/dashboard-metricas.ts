// Métricas do dashboard do Recebimento — tipos e regras puras (sem banco, sem React).
// Spec: docs/superpowers/specs/2026-10-20-dashboard-recebimento-metricas-design.md
// A régua de contagem mora no banco (rec_dashboard_metricas, migração 0154); aqui ficam os tipos,
// o "X dias" da URL, os formatadores e os textos dos ⓘ.
import { percentual, urlDosFiltros, type FiltrosDashboard } from './dashboard'

export interface PeriodoVolume {
  /** Segunda-feira (semana) ou dia 1º (mês), 'AAAA-MM-DD'. */
  inicio: string
  itens: number
  embs: number
}

export interface FornecedorQualidade {
  /** '' = fornecedor em branco (a tela escreve "(sem fornecedor)"). */
  fornecedor: string
  comResultado: number
  reprovados: number
}

export interface MaterialQualidade {
  /** Código do material (nunca vazio: material sem código fica de fora). */
  codigo: string
  descricao: string
  comResultado: number
  reprovados: number
}

export interface MotivoReprovacao {
  motivo: string
  itens: number
}

export interface FornecedorAtraso {
  fornecedor: string
  comPrazo: number
  atrasados: number
  /** null = sem base. */
  mediaDias: number | null
}

export interface EstatisticaTempo {
  n: number
  /** null = sem base (a tela mostra "—", nunca zero). */
  mediaDias: number | null
  medianaDias: number | null
}

export interface FaixasPendencias {
  noPrazo: number
  d1a7: number
  d8a30: number
  d30mais: number
  semPrevista: number
}

export interface FornecedorPendencia {
  fornecedor: string
  pendentes: number
  atrasados: number
}

export interface MetricasDashboard {
  volume: { semanas: PeriodoVolume[]; meses: PeriodoVolume[] }
  qualidade: {
    totais: { comResultado: number; reprovados: number; pecasRecebidas: number; pecasReprovadas: number }
    fornecedores: FornecedorQualidade[]
    materiais: MaterialQualidade[]
    motivos: MotivoReprovacao[]
  }
  atraso: {
    totais: { comPrazo: number; atrasados: number; mediaDiasAtraso: number | null }
    fornecedores: FornecedorAtraso[]
  }
  tempo: {
    recebimento: EstatisticaTempo
    qualidade: EstatisticaTempo
    parados: { dias: number; recebimento: number; qualidade: number }
    semTempo: number
  }
  pendencias: {
    total: number
    faixas: FaixasPendencias
    fornecedores: FornecedorPendencia[]
  }
}

/** Os valores de "X dias" (parados) aceitos pelo banco. */
export const PARADOS_OPCOES = [3, 7, 15, 30] as const
export const PARADOS_PADRAO = 7

/** O `parado` da URL: só 3, 7, 15 ou 30 valem; qualquer outra coisa cai em 7. */
export function paradoDaUrl(sp: Record<string, string | string[] | undefined>): number {
  const bruto = sp['parado']
  const texto = (Array.isArray(bruto) ? bruto[0] : bruto)?.trim() ?? ''
  if (!/^\d+$/.test(texto)) return PARADOS_PADRAO
  const n = Number(texto)
  return (PARADOS_OPCOES as readonly number[]).includes(n) ? n : PARADOS_PADRAO
}

/** A query string dos filtros mais o `parado` (só quando ≠ 7: o link limpo continua valendo o padrão). */
export function urlDosFiltrosComParado(f: FiltrosDashboard, paradoDias: number, agora: Date): string {
  const p = new URLSearchParams(urlDosFiltros(f, agora))
  if (paradoDias !== PARADOS_PADRAO) p.set('parado', String(paradoDias))
  return p.toString()
}

const fmtDias = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** 1.8 → '1,8 d' · 0 → '0,0 d' · null → '—' (sem base nunca vira zero). */
export function formatarDias(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${fmtDias.format(n)} d`
}

export interface LinhaFaixa {
  chave: keyof FaixasPendencias
  rotulo: string
  valor: number
}

/** As cinco faixas de pendência, rotuladas e na ordem de leitura. */
export function faixasPendencias(f: FaixasPendencias): LinhaFaixa[] {
  return [
    { chave: 'noPrazo', rotulo: 'No prazo', valor: f.noPrazo },
    { chave: 'd1a7', rotulo: '1 a 7 dias', valor: f.d1a7 },
    { chave: 'd8a30', rotulo: '8 a 30 dias', valor: f.d8a30 },
    { chave: 'd30mais', rotulo: 'Mais de 30 dias', valor: f.d30mais },
    { chave: 'semPrevista', rotulo: 'Sem data prevista', valor: f.semPrevista },
  ]
}

/** Taxa de reprovação por item: reprovados ÷ itens com resultado. Sem base = null ("—"). */
export function taxaPorItem(reprovados: number, comResultado: number): number | null {
  return percentual(reprovados, comResultado)
}

/** Os textos dos ⓘ das métricas — a régua de cada bloco em português. */
export const EXPLICA_METRICAS = {
  atrasados:
    'Dos itens com data prevista e data de chegada no período, quantos chegaram depois da data ' +
    'prevista. Conta por item, pela data de chegada.',
  reprovacao:
    'Itens reprovados ÷ itens que já têm resultado (aprovado ou reprovado), pela data de chegada. ' +
    'Conta por item, não por peça; o total de peças aparece na dica.',
  medianaQualidade:
    'Metade dos itens levou menos que isto, e metade mais, desde a primeira conferência até a ' +
    'finalização. Mediana não se deixa puxar por um item muito demorado. Respeita o período.',
  parados:
    'Itens que estão agora sem andar: abertos esperando conferência e itens na Qualidade há mais ' +
    'dias que o escolhido. É a situação de hoje: ignora De e Até.',
  volume:
    'Itens e EMBs que chegaram em cada semana (segunda a domingo) ou mês, pela data de chegada. ' +
    'Período sem chegada aparece com altura zero. Respeita os filtros e o período.',
  qualidade:
    'Pela data de chegada, só itens que já têm resultado. Fornecedores e materiais aparecem se ' +
    'tiveram ao menos um item reprovado. Item reprovado = status ou resultado "reprovado". Clique ' +
    'num fornecedor ou material para filtrar a tela.',
  atraso:
    'Itens com data prevista e data de chegada: dias de atraso = chegada − prevista; atrasado é ' +
    'mais de zero dia. A média considera só os atrasados. Pela data de chegada; respeita o período.',
  tempo:
    'Recebimento: da chegada até a primeira conferência. Qualidade: da primeira conferência até a ' +
    'finalização. Itens finalizados sem registro de entrada na Qualidade ficam de fora e são ' +
    'contados à parte. Parados é a situação de hoje e ignora De e Até.',
  pendencias:
    'Itens abertos que ainda não chegaram (sem data de chegada), por quanto já passou da data ' +
    'prevista. É a situação de hoje: ignora De e Até. Respeita fornecedor, comprador, EMB e código.',
} as const
