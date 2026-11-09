import { minutosDeExpediente } from './horas-de-turno'
import type { Intervalo } from './intervalos'
import { montarRelatorioParados, type OpDoRelatorio, type RegraDoRelatorio, type SnParado, type SnParadoComIdade } from './parados-relatorio'

/**
 * Os filtros da tela "Peças paradas" (/shopfloor/analisar/parados). A tela não depende de regra: tempo e
 * situação da OP vão ao banco (sf_pecas_paradas, 0180); posto, tipo de parada, agrupamento e ordem são
 * aplicados na tela, sobre a mesma resposta. Tudo fica na URL (o link é compartilhável). O link da mensagem
 * do alerta (`?regra=<id>`) só PREENCHE os filtros que a URL não traz com os da regra.
 */

export type SituacaoOp = 'ativas' | 'finalizadas' | 'todas'
/** 'posto' = parada no posto; 'conserto' = reprovada aguardando conserto, ou já na Manutenção. */
export type TipoParada = 'todos' | 'posto' | 'conserto'
export type Agrupamento = 'op' | 'posto'
export type Ordem = 'antiga' | 'pecas' | 'nome'

export interface FiltrosParados {
  horas: number
  situacao: SituacaoOp
  /** Vazio = todos os postos. */
  postos: string[]
  tipo: TipoParada
  agrupar: Agrupamento
  ordem: Ordem
}

export const OPCOES_HORAS = [4, 8, 24, 72, 168] as const
export const FILTROS_PADRAO: FiltrosParados = {
  horas: 24, situacao: 'ativas', postos: [], tipo: 'todos', agrupar: 'op', ordem: 'antiga',
}
/** O maior tempo aceito na URL (1 ano), para um link digitado não virar um corte absurdo. */
const HORAS_MAX = 24 * 365

export const ROTULOS_SITUACAO: Record<SituacaoOp, string> = {
  ativas: 'Ativas', finalizadas: 'Finalizadas', todas: 'Ativas e finalizadas',
}
export const ROTULOS_TIPO: Record<TipoParada, string> = {
  todos: 'Todas', posto: 'Parada no posto', conserto: 'Aguardando conserto',
}
export const ROTULOS_AGRUPAR: Record<Agrupamento, string> = { op: 'Por OP', posto: 'Por posto' }
export const ROTULOS_ORDEM: Record<Ordem, string> = {
  antiga: 'Mais antiga primeiro', pecas: 'Mais peças primeiro', nome: 'Nome (A–Z)',
}

type Params = Record<string, string | string[] | undefined>
const um = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)?.trim() || undefined
const de = <T extends string>(v: string | undefined, validos: Record<T, string>): T | undefined =>
  v !== undefined && Object.hasOwn(validos, v) ? (v as T) : undefined

/** Os filtros da URL; o que a URL não traz vem da regra do link (se houver) e, por fim, do padrão. */
export function lerFiltros(params: Params, regra: RegraDoRelatorio | null): FiltrosParados {
  const base: FiltrosParados = regra
    ? {
        ...FILTROS_PADRAO,
        horas: regra.limiteHoras,
        situacao: regra.soOpsAtivas ? 'ativas' : 'todas',
        postos: [...regra.postos],
        tipo: regra.incluirManutencao ? 'todos' : 'posto',
      }
    : FILTROS_PADRAO
  const h = Number(um(params.horas))
  const postos = um(params.postos)
  return {
    horas: Number.isInteger(h) && h >= 1 && h <= HORAS_MAX ? h : base.horas,
    situacao: de(um(params.situacao), ROTULOS_SITUACAO) ?? base.situacao,
    postos: postos === undefined ? base.postos : postos === '*' ? [] : postos.split(',').map((p) => p.trim()).filter(Boolean),
    tipo: de(um(params.tipo), ROTULOS_TIPO) ?? base.tipo,
    agrupar: de(um(params.agrupar), ROTULOS_AGRUPAR) ?? base.agrupar,
    ordem: de(um(params.ordem), ROTULOS_ORDEM) ?? base.ordem,
  }
}

/** A query string dos filtros (todos explícitos, para a regra do link não reaparecer por baixo). */
export function queryDosFiltros(f: FiltrosParados, regraId: string | null): string {
  const q = new URLSearchParams()
  if (regraId) q.set('regra', regraId)
  q.set('horas', String(f.horas))
  q.set('situacao', f.situacao)
  q.set('postos', f.postos.length === 0 ? '*' : f.postos.join(','))
  q.set('tipo', f.tipo)
  q.set('agrupar', f.agrupar)
  q.set('ordem', f.ordem)
  return q.toString()
}

/** As opções do tempo: as fixas e, se a regra do link usa outro limite, ele também (em ordem). */
export function opcoesDeHoras(atual: number): number[] {
  const lista: number[] = [...OPCOES_HORAS]
  if (!lista.includes(atual)) lista.push(atual)
  return lista.sort((a, b) => a - b)
}

/** Uma peça como a tela a recebe: a de `sf_pecas_paradas` (0180), com a situação da OP. */
export interface SnParadoTela extends SnParado {
  finalizada: boolean
}

/** Lê as linhas de `sf_pecas_paradas`. Linha sem PMO, OP, posto ou data legível é descartada. */
export function lerPecasParadas(linhas: unknown): SnParadoTela[] {
  const saida: SnParadoTela[] = []
  for (const bruto of Array.isArray(linhas) ? linhas : []) {
    if (bruto === null || typeof bruto !== 'object') continue
    const l = bruto as Record<string, unknown>
    const pmo = String(l.pmo ?? '').trim()
    const op = typeof l.op === 'string' ? l.op : ''
    const posto = typeof l.posto === 'string' ? l.posto : ''
    const em = new Date(String(l.em ?? ''))
    if (pmo === '' || op === '' || posto === '' || Number.isNaN(em.getTime())) continue
    const pecas = Number(l.pecas)
    saida.push({
      pmo, op, posto, reprovada: l.reprovada === true,
      numeroSerie: typeof l.numero_serie === 'string' ? l.numero_serie : '',
      pecas: Number.isFinite(pecas) && pecas > 0 ? pecas : 1,
      em,
      finalizada: l.finalizada === true,
    })
  }
  return saida
}

/** A peça está parada no posto, ou aguarda conserto (reprovada, ou já na Manutenção)? */
export function tipoDaPeca(s: Pick<SnParado, 'posto' | 'reprovada'>): Exclude<TipoParada, 'todos'> {
  return s.reprovada || s.posto.trim().toLowerCase() === 'manutenção' ? 'conserto' : 'posto'
}

/** Posto e tipo de parada (os filtros da tela; tempo e situação já vieram filtrados do banco). */
export function filtrarPecas<T extends SnParado>(sns: readonly T[], f: Pick<FiltrosParados, 'postos' | 'tipo'>): T[] {
  const postos = new Set(f.postos)
  return sns.filter((s) => (postos.size === 0 || postos.has(s.posto)) && (f.tipo === 'todos' || tipoDaPeca(s) === f.tipo))
}

/** Os postos que aparecem nas peças (já filtradas pelo tipo), com as peças de cada um, por nome. */
export function postosComPecas(sns: readonly SnParado[]): { posto: string; pecas: number }[] {
  const m = new Map<string, number>()
  for (const s of sns) m.set(s.posto, (m.get(s.posto) ?? 0) + s.pecas)
  return [...m.entries()]
    .map(([posto, pecas]) => ({ posto, pecas }))
    .sort((a, b) => a.posto.localeCompare(b.posto, 'pt-BR'))
}

const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true })

/** Um posto no agrupamento "por posto": as peças paradas nele, somando todas as OPs. */
export interface PostoDoRelatorio {
  posto: string
  pecas: number
  maisAntigaMin: number
  /** Peças que aguardam conserto (reprovadas, ou na Manutenção). */
  consertos: number
  /** As OPs com peça parada neste posto, da que tem mais peças para a que tem menos. */
  ops: { pmo: string; op: string; pecas: number }[]
  /** Da mais antiga para a mais nova. */
  sns: (SnParadoComIdade & { finalizada?: boolean })[]
}

/** Agrupa por posto (soma todas as OPs). Idade em expediente se houver turnos (link de regra com turno). */
export function agruparPorPosto<T extends SnParado>(
  sns: readonly T[], turnos: readonly Intervalo[], agora: Date,
): PostoDoRelatorio[] {
  const m = new Map<string, PostoDoRelatorio>()
  for (const s of sns) {
    let p = m.get(s.posto)
    if (!p) {
      p = { posto: s.posto, pecas: 0, maisAntigaMin: 0, consertos: 0, ops: [], sns: [] }
      m.set(s.posto, p)
    }
    const minutos = minutosDeExpediente(s.em, agora, turnos)
    p.pecas += s.pecas
    p.maisAntigaMin = Math.max(p.maisAntigaMin, minutos)
    if (tipoDaPeca(s) === 'conserto') p.consertos += s.pecas
    p.sns.push({ ...s, minutos })
    const op = p.ops.find((o) => o.pmo === s.pmo && o.op === s.op)
    if (op) op.pecas += s.pecas
    else p.ops.push({ pmo: s.pmo, op: s.op, pecas: s.pecas })
  }
  for (const p of m.values()) {
    p.sns.sort((a, b) => a.em.getTime() - b.em.getTime() || porNome(a.numeroSerie, b.numeroSerie))
    p.ops.sort((a, b) => b.pecas - a.pecas || porNome(`${a.pmo}/${a.op}`, `${b.pmo}/${b.op}`))
  }
  return [...m.values()]
}

/** Ordena as linhas (OPs ou postos) pela ordem escolhida. Empate: mais antiga, depois nome. */
export function ordenarLinhas<T extends { pecas: number; maisAntigaMin: number }>(
  linhas: readonly T[], ordem: Ordem, nome: (l: T) => string,
): T[] {
  const antiga = (a: T, b: T) => b.maisAntigaMin - a.maisAntigaMin
  const pecas = (a: T, b: T) => b.pecas - a.pecas
  const nomes = (a: T, b: T) => porNome(nome(a), nome(b))
  const cmp = ordem === 'pecas' ? [pecas, antiga, nomes] : ordem === 'nome' ? [nomes] : [antiga, pecas, nomes]
  return [...linhas].sort((a, b) => cmp.reduce((r, f) => r || f(a, b), 0))
}

/** O agrupamento por OP (o mesmo do alerta), já ordenado, com a situação de cada OP. */
export function agruparPorOp(
  sns: readonly SnParadoTela[], turnos: readonly Intervalo[], agora: Date, ordem: Ordem,
): (OpDoRelatorio & { finalizada: boolean })[] {
  const finalizadas = new Set(sns.filter((s) => s.finalizada).map((s) => `${s.pmo}/${s.op}`))
  const ops = montarRelatorioParados(sns, turnos, agora).ops.map((o) => ({ ...o, finalizada: finalizadas.has(`${o.pmo}/${o.op}`) }))
  return ordenarLinhas(ops, ordem, (o) => `${o.pmo}/${o.op}`)
}
