// Dashboard de divergências do Recebimento — regras puras (sem banco, sem React).
// Spec: docs/superpowers/specs/2026-10-14-dashboard-recebimento-design.md
// A régua de contagem mora no banco (rec_dashboard, migração 0152); aqui ficam os filtros e a URL,
// a porcentagem, os textos dos ⓘ e o que cada clique num gráfico faz com os filtros.

/** Sinal da divergência que um clique em "Positivas × negativas" aplica. */
export type Sinal = 'positiva' | 'negativa'

/** Os filtros da tela. String vazia = sem filtro. Datas em 'AAAA-MM-DD' (data_chegada é DATE). */
export interface FiltrosDashboard {
  fornecedor: string
  comprador: string
  emb: string
  codigo: string
  de: string
  ate: string
  sinal: Sinal | ''
}

/** Nenhum filtro, nem de data — é o que "Limpar filtros" aplica. */
export const FILTROS_LIMPOS: FiltrosDashboard = {
  fornecedor: '', comprador: '', emb: '', codigo: '', de: '', ate: '', sinal: '',
}

export interface TotaisDashboard {
  itens: number
  comDivergencia: number
  semJustificativa: number
  positivas: number
  negativas: number
  embs: number
  /** Itens sem data_chegada que um recorte por data deixou de fora (0 quando não há recorte). */
  foraDoRecortePorData: number
}

export interface FornecedorDashboard {
  /** '' = fornecedor em branco (a tela escreve "(sem fornecedor)"). */
  fornecedor: string
  divergentes: number
  itens: number
}

export interface SemanaDashboard {
  /** Segunda-feira da semana, 'AAAA-MM-DD'. */
  inicio: string
  justificadas: number
  semJustificativa: number
}

export interface DadosDashboard {
  totais: TotaisDashboard
  fornecedores: FornecedorDashboard[]
  semanas: SemanaDashboard[]
}

export interface OpcoesDashboard {
  fornecedores: string[]
  compradores: string[]
}

/** O que um clique num gráfico pede. */
export type CliqueDashboard = { fornecedor: string } | { semana: string } | { sinal: Sinal }

/** Recorte de data padrão, em dias, contando hoje. É padrão da TELA (o banco não tem padrão). */
export const DIAS_JANELA_PADRAO = 90

/** Parâmetro de URL que diz "sem recorte de data" (sem ele, a URL sem datas vale os 90 dias). */
export const PERIODO_TUDO = 'tudo'

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/

/** 'AAAA-MM-DD' de um dia que existe no calendário; qualquer outra coisa é inválida. */
export function diaValido(valor: string): boolean {
  if (!RE_DIA.test(valor)) return false
  const [a, m, d] = valor.split('-').map(Number)
  const data = new Date(Date.UTC(a!, m! - 1, d!))
  return data.getUTCFullYear() === a && data.getUTCMonth() === m! - 1 && data.getUTCDate() === d
}

/** Soma (ou subtrai) dias de um 'AAAA-MM-DD', sem fuso no meio (conta em UTC puro). */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a!, m! - 1, d! + n)).toISOString().slice(0, 10)
}

/** O dia de hoje na fábrica (São Paulo), 'AAAA-MM-DD' — nunca o dia do servidor (que roda em UTC). */
export function hojeSp(agora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora)
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${parte('year')}-${parte('month')}-${parte('day')}`
}

/** Os últimos 90 dias, contando hoje: de = hoje − 89, até = hoje. */
export function janelaPadrao(agora: Date): { de: string; ate: string } {
  const ate = hojeSp(agora)
  return { de: somarDias(ate, -(DIAS_JANELA_PADRAO - 1)), ate }
}

/** 'AAAA-MM-DD' que existe no calendário E cai numa segunda-feira. */
export function ehSegunda(dia: string): boolean {
  if (!diaValido(dia)) return false
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay() === 1
}

/** Domingo da semana que começa nessa segunda. */
export function fimDaSemana(inicio: string): string {
  return somarDias(inicio, 6)
}

type ParamsUrl = Record<string, string | string[] | undefined>

/** Tamanho máximo de um texto livre vindo da URL (nada da URL é confiável). */
export const MAX_TEXTO_URL = 200

function primeiro(sp: ParamsUrl, chave: string): string {
  const v = sp[chave]
  return (Array.isArray(v) ? v[0] : v)?.trim().slice(0, MAX_TEXTO_URL) ?? ''
}

/**
 * Os filtros a partir da URL (searchParams). Nada da URL é confiável: data inválida e sinal
 * desconhecido são ignorados, e texto livre acima de 200 caracteres é cortado. `de` depois de `ate`
 * (digitado ao contrário) troca os dois lados.
 *   - `periodo=tudo`            → sem recorte de data (ignora de/ate).
 *   - sem `de` e sem `ate`      → os últimos 90 dias (o padrão).
 *   - com `de` e/ou `ate`       → o que veio (um lado só = aberto do outro).
 */
export function filtrosDaUrl(sp: ParamsUrl, agora: Date): FiltrosDashboard {
  const sinal = primeiro(sp, 'sinal')
  const f: FiltrosDashboard = {
    fornecedor: primeiro(sp, 'fornecedor'),
    comprador: primeiro(sp, 'comprador'),
    emb: primeiro(sp, 'emb'),
    codigo: primeiro(sp, 'codigo'),
    de: '',
    ate: '',
    sinal: sinal === 'positiva' || sinal === 'negativa' ? sinal : '',
  }
  if (primeiro(sp, 'periodo') === PERIODO_TUDO) return f
  const de = primeiro(sp, 'de')
  const ate = primeiro(sp, 'ate')
  const deOk = diaValido(de) ? de : ''
  const ateOk = diaValido(ate) ? ate : ''
  if (deOk === '' && ateOk === '') return { ...f, ...janelaPadrao(agora) }
  // Os dois lados válidos e invertidos: o usuário digitou ao contrário, vale o intervalo que ele quis.
  if (deOk !== '' && ateOk !== '' && deOk > ateOk) return { ...f, de: ateOk, ate: deOk }
  return { ...f, de: deOk, ate: ateOk }
}

/**
 * A query string (sem o '?') que reproduz esses filtros. O recorte padrão NÃO vai para a URL
 * (o link "limpo" continua querendo dizer "os últimos 90 dias" para quem abrir amanhã); sem recorte
 * nenhum vira `periodo=tudo`.
 */
export function urlDosFiltros(f: FiltrosDashboard, agora: Date): string {
  const p = new URLSearchParams()
  if (f.fornecedor) p.set('fornecedor', f.fornecedor)
  if (f.comprador) p.set('comprador', f.comprador)
  if (f.emb) p.set('emb', f.emb)
  if (f.codigo) p.set('codigo', f.codigo)
  const padrao = janelaPadrao(agora)
  if (f.de === '' && f.ate === '') p.set('periodo', PERIODO_TUDO)
  else if (f.de !== padrao.de || f.ate !== padrao.ate) {
    if (f.de) p.set('de', f.de)
    if (f.ate) p.set('ate', f.ate)
  }
  if (f.sinal) p.set('sinal', f.sinal)
  return p.toString()
}

/** O que um clique num gráfico faz com os filtros: APLICA (não alterna). Tirar é pela etiqueta. */
export function aplicarClique(f: FiltrosDashboard, clique: CliqueDashboard): FiltrosDashboard {
  if ('fornecedor' in clique) {
    // Fornecedor em branco (inclusive só espaço/tab) não vira filtro: texto vazio, no banco, é
    // "sem filtro". O valor entra APARADO, igual ao que volta da URL (primeiro() apara).
    const fornecedor = clique.fornecedor.trim()
    return fornecedor === '' ? f : { ...f, fornecedor }
  }
  if ('semana' in clique) {
    // Só uma segunda-feira que existe no calendário abre uma semana de segunda a domingo.
    return ehSegunda(clique.semana) ? { ...f, de: clique.semana, ate: fimDaSemana(clique.semana) } : f
  }
  return { ...f, sinal: clique.sinal }
}

export type ChaveEtiqueta = 'fornecedor' | 'comprador' | 'emb' | 'codigo' | 'periodo' | 'sinal'

export interface EtiquetaFiltro {
  chave: ChaveEtiqueta
  texto: string
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
export function diaBr(dia: string): string {
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}

/** As etiquetas removíveis dos filtros aplicados, na ordem da barra de filtros. */
export function etiquetasDosFiltros(f: FiltrosDashboard): EtiquetaFiltro[] {
  const e: EtiquetaFiltro[] = []
  if (f.fornecedor) e.push({ chave: 'fornecedor', texto: `Fornecedor: ${f.fornecedor}` })
  if (f.comprador) e.push({ chave: 'comprador', texto: `Comprador: ${f.comprador}` })
  if (f.emb) e.push({ chave: 'emb', texto: `EMB: ${f.emb}` })
  if (f.codigo) e.push({ chave: 'codigo', texto: `Código: ${f.codigo}` })
  if (f.de && f.ate) e.push({ chave: 'periodo', texto: `Chegada: ${diaBr(f.de)} a ${diaBr(f.ate)}` })
  else if (f.de) e.push({ chave: 'periodo', texto: `Chegada: a partir de ${diaBr(f.de)}` })
  else if (f.ate) e.push({ chave: 'periodo', texto: `Chegada: até ${diaBr(f.ate)}` })
  if (f.sinal) e.push({ chave: 'sinal', texto: f.sinal === 'positiva' ? 'Só positivas' : 'Só negativas' })
  return e
}

/** Os filtros sem aquele que a etiqueta representa. Tirar o período = sem recorte de data. */
export function semFiltro(f: FiltrosDashboard, chave: ChaveEtiqueta): FiltrosDashboard {
  if (chave === 'periodo') return { ...f, de: '', ate: '' }
  return { ...f, [chave]: '' }
}

/**
 * Porcentagem com uma casa. NÃO arredonda para 100 quando não é 100 (lição do dashboard do
 * ShopFloor, 02/09): 9.999 de 10.000 é 99,9%, não 100%. Total zero = null (a tela mostra "—").
 */
export function percentual(parte: number, total: number): number | null {
  if (!(total > 0)) return null
  const arredondado = Math.round((parte * 1000) / total) / 10
  // Tem divergência, mas menos de 0,05%: o valor exato (positivo, abaixo de 0,1) em vez de 0 —
  // formatarPercentual escreve "<0,1%". Mostrar "0%" com uma divergência esconderia o item.
  if (parte > 0 && arredondado === 0) return (parte * 100) / total
  if (arredondado >= 100 && parte < total) return 99.9
  return arredondado
}

const fmtNumero = new Intl.NumberFormat('pt-BR')
const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

export function formatarNumero(n: number): string {
  return fmtNumero.format(n)
}

/** 10.7 → '10,7%' · 100 → '100%' · 0,03 → '<0,1%' (existe, mas é menos que uma casa) · null → '—'. */
export function formatarPercentual(p: number | null): string {
  if (p === null) return '—'
  if (p > 0 && p < 0.1) return '<0,1%'
  return `${fmtPct.format(p)}%`
}

/** '' → '(sem fornecedor)'. */
export function rotuloFornecedor(fornecedor: string): string {
  return fornecedor === '' ? '(sem fornecedor)' : fornecedor
}

/**
 * O rodapé da contagem: "137 de 1.284 itens (10,7%) em 42 EMBs", e quantos ficaram fora do período
 * por não ter data de chegada.
 */
export function textoRodape(t: TotaisDashboard): string {
  if (t.itens === 0) {
    return t.foraDoRecortePorData > 0
      ? `Nenhum item neste recorte. ${textoFora(t.foraDoRecortePorData)}`
      : 'Nenhum item neste recorte.'
  }
  const itens = t.itens === 1 ? 'item' : 'itens'
  const embs = t.embs === 1 ? 'EMB' : 'EMBs'
  const base = `${formatarNumero(t.comDivergencia)} de ${formatarNumero(t.itens)} ${itens} ` +
    `(${formatarPercentual(percentual(t.comDivergencia, t.itens))}) em ${formatarNumero(t.embs)} ${embs}`
  return t.foraDoRecortePorData > 0 ? `${base}. ${textoFora(t.foraDoRecortePorData)}` : base
}

function textoFora(n: number): string {
  return n === 1
    ? '1 item sem data de chegada ficou fora do período.'
    : `${formatarNumero(n)} itens sem data de chegada ficaram fora do período.`
}

/** Os textos dos ⓘ — a definição de cada número em português (spec §3). */
export const EXPLICA = {
  itens:
    'Linhas de processo (um material de uma EMB) que caem nos filtros, contadas pela data de ' +
    'chegada. Processos cancelados ficam de fora.',
  comDivergencia:
    'Dos itens, os que têm divergência de quantidade diferente de zero — a mesma regra do filtro ' +
    '"Divergências" da grade de Processos. Item ainda não conferido (divergência vazia ou que não ' +
    'é número) não conta. Com "Só positivas" ou "Só negativas", conta só aquele sinal.',
  semJustificativa:
    'Dos itens com divergência, os que ninguém justificou ainda (justificativa vazia ou só com ' +
    'espaços). Justificar é na grade de Processos.',
  embs:
    'EMBs distintas entre os itens do recorte (com ou sem divergência).',
  fornecedores:
    'Os 10 fornecedores com mais itens divergentes no recorte. Ao lado, quanto isso é dos itens ' +
    'daquele fornecedor. Clique numa barra para filtrar a tela por ele.',
  semanas:
    'Itens divergentes por semana de chegada (segunda a domingo), separados em justificados e sem ' +
    'justificativa. Semana sem divergência aparece com altura zero. Itens sem data de chegada não ' +
    'entram aqui. Clique numa semana para filtrar por ela.',
  sinal:
    'Itens que chegaram a mais (divergência maior que zero) e a menos (menor que zero). Clique numa ' +
    'barra para ver só aquele sinal.',
} as const
