import { normalizarNs, type NsNormalizado } from './numero-serie'

/**
 * A ordem de serviço do SAT (spec 2026-11-26-sat-ordem-servico-design.md). Entrega 1: as etapas até a qualidade e a
 * manutenção (defeitos, peças, laudo, troca de NS). Os valores são os mesmos da migração 0198; o banco confere tudo
 * de novo (estas validações só evitam ida e volta e dão a mensagem certa).
 */
export const ETAPAS = ['recebido', 'nota_pendente', 'disponivel', 'em_manutencao', 'qualidade'] as const
export type Etapa = (typeof ETAPAS)[number]

export const ROTULO_ETAPA: Record<Etapa, string> = {
  recebido: 'Recebido',
  nota_pendente: 'Nota pendente',
  disponivel: 'Disponível para manutenção',
  em_manutencao: 'Em manutenção',
  qualidade: 'Qualidade',
}

export const ehEtapa = (x: unknown): x is Etapa => typeof x === 'string' && (ETAPAS as readonly string[]).includes(x)

export const TIPOS = ['em_garantia', 'fora_garantia', 'remanufatura', 'retorno_peca'] as const
export type TipoOrdem = (typeof TIPOS)[number]

export const ROTULO_TIPO: Record<TipoOrdem, string> = {
  em_garantia: 'Em garantia',
  fora_garantia: 'Fora da garantia',
  remanufatura: 'Remanufatura',
  retorno_peca: 'Retorno de peça',
}

export const ehTipo = (x: unknown): x is TipoOrdem => typeof x === 'string' && (TIPOS as readonly string[]).includes(x)

/** `null` = a planilha não diz se é garantia (ticket sem a coluna, ou sem ticket). */
export const rotuloTipo = (t: TipoOrdem | null) => (t ? ROTULO_TIPO[t] : 'Garantia a definir')

export interface ColunaFila<T> {
  etapa: Etapa
  rotulo: string
  ordens: T[]
}

/**
 * As colunas do quadro da fila, na ordem do fluxo. A OS nasce já em "nota pendente" ou "disponível", então
 * "Recebido" só vira coluna se alguma OS estiver lá (correção do administrador).
 */
export function agruparPorEtapa<T extends { etapa: Etapa }>(ordens: T[]): ColunaFila<T>[] {
  return ETAPAS
    .filter((e) => e !== 'recebido' || ordens.some((o) => o.etapa === 'recebido'))
    .map((etapa) => ({ etapa, rotulo: ROTULO_ETAPA[etapa], ordens: ordens.filter((o) => o.etapa === etapa) }))
}

/** Há quanto tempo (de `iso` até `agora`): minutos até 1 h, horas até 48 h, depois dias. */
export function tempoDesde(iso: string, agora: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const min = Math.max(0, Math.floor((agora - t) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

/** Código de item do Compels: maiúsculo, sem espaço (o mesmo padrão do banco). */
export const CODIGO_ITEM = /^[A-Z0-9][A-Z0-9_.-]{0,59}$/

/** O produto da OS como código do Compels (ex.: `PMOC31`); texto livre ou só número → `null`. */
export function codigoDoProduto(produto: string): string | null {
  const c = (produto ?? '').trim().toUpperCase()
  return CODIGO_ITEM.test(c) && /^[A-Z]/.test(c) ? c : null
}

export const MAX_SOLUCAO = 2000
export const MAX_LAUDO = 4000
export const MAX_DESCRICAO_PECA = 300
export const MAX_MOTIVO_CORRECAO = 500
export const MAX_QUANTIDADE = 9999

export type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const limpo = (s: unknown) => (typeof s === 'string' ? s.trim() : '')

export function validarDefeito(i: { defeitoId: string; solucao: string }): Validacao<{ defeitoId: string; solucao: string }> {
  if (typeof i.defeitoId !== 'string' || !UUID.test(i.defeitoId)) return { ok: false, erro: 'Escolha o defeito da lista.' }
  const solucao = limpo(i.solucao)
  if (solucao === '') return { ok: false, erro: 'Descreva a solução do defeito.' }
  if (solucao.length > MAX_SOLUCAO) return { ok: false, erro: `A solução passa de ${MAX_SOLUCAO} caracteres.` }
  return { ok: true, valor: { defeitoId: i.defeitoId, solucao } }
}

export function validarPeca(i: { codigo: string; descricao: string; quantidade: string | number }):
  Validacao<{ codigo: string; descricao: string; quantidade: number }> {
  const codigo = limpo(i.codigo).toUpperCase()
  if (!CODIGO_ITEM.test(codigo)) return { ok: false, erro: 'Código do item inválido.' }
  const descricao = limpo(i.descricao)
  if (descricao.length > MAX_DESCRICAO_PECA) return { ok: false, erro: `A descrição passa de ${MAX_DESCRICAO_PECA} caracteres.` }
  const q = typeof i.quantidade === 'number' ? i.quantidade : Number(limpo(i.quantidade).replace(',', '.'))
  if (!Number.isFinite(q) || q <= 0 || q > MAX_QUANTIDADE) return { ok: false, erro: 'Quantidade inválida (maior que zero, até 9999).' }
  return { ok: true, valor: { codigo, descricao, quantidade: q } }
}

export function validarLaudo(laudo: string): Validacao<string> {
  const t = limpo(laudo)
  if (t.length > MAX_LAUDO) return { ok: false, erro: `O laudo passa de ${MAX_LAUDO} caracteres.` }
  return { ok: true, valor: t }
}

export function validarTrocaNs(ns: string): Validacao<NsNormalizado> {
  const t = limpo(ns)
  if (t === '') return { ok: false, erro: 'Informe o número de série novo.' }
  if (t.length > 200) return { ok: false, erro: 'Número de série longo demais.' }
  return { ok: true, valor: normalizarNs(t) }
}

export function validarCorrecaoEtapa(etapa: string, motivo: string): Validacao<{ etapa: Etapa; motivo: string }> {
  if (!ehEtapa(etapa)) return { ok: false, erro: 'Etapa inválida.' }
  const m = limpo(motivo).replace(/\s+/g, ' ')
  if (m.length < 3 || m.length > MAX_MOTIVO_CORRECAO) return { ok: false, erro: 'Escreva o motivo da correção (3 a 500 caracteres).' }
  return { ok: true, valor: { etapa, motivo: m } }
}
