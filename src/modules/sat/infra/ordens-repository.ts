import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarNs, type NsNormalizado } from '../domain/numero-serie'
import { ehEtapa, ehTipo, tempoDesde, type Etapa, type TipoOrdem } from '../domain/ordem'
import type { PecaSugerida } from '../domain/estrutura'
import { ErroDoBanco } from './repository'

/**
 * A ordem de serviço do SAT (0198): leitura pelo RLS (`sat.visualizar`); escrita SÓ pelas funções security definer,
 * que conferem a permissão e a etapa de novo no banco.
 */
type Linha = Record<string, unknown>
const txt = (v: unknown) => (typeof v === 'string' ? v : '')
const txtOuNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATA = /^\d{4}-\d{2}-\d{2}$/
const literal = (s: string) => s.replace(/[\\%_*]/g, (c) => `\\${c}`)
const embutido = (v: unknown): Linha | null => ((Array.isArray(v) ? v[0] : v) as Linha | null | undefined) ?? null
const objeto = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const LIMITE_FILA = 500

export interface FiltroOrdens {
  tipo: '' | TipoOrdem | 'a_definir'
  cliente: string
  ns: string
  /** `aaaa-mm-dd` (inclusive), pela data em que a OS nasceu. */
  de: string
  ate: string
}

export interface OrdemResumo {
  id: string
  numero: string
  etapa: Etapa
  etapaDesde: string
  /** "5 h", "3 d" — calculado aqui (fora do componente). */
  tempoNaEtapa: string
  tipo: TipoOrdem | null
  cliente: string
  nsAtual: string
  produto: string
  ticketNumero: string
  tecnicoNome: string
  criadoEm: string
}

export interface DefeitoDaOrdem {
  id: string
  defeitoId: string
  descricao: string
  origem: 'manutencao' | 'qualidade'
  solucao: string
  usuarioNome: string
  em: string
}

export interface PecaDaOrdem {
  id: string
  codigo: string
  descricao: string
  quantidade: number
  situacao: 'trocada' | 'devolvida'
  usuarioNome: string
  em: string
}

export interface TrocaNs {
  id: string
  nsAntigo: string
  nsNovo: string
  usuarioNome: string
  em: string
}

export type EventoOrdemTipo = 'etapa' | 'correcao_etapa' | 'garantia' | 'defeito' | 'peca' | 'laudo' | 'ns'

export interface EventoOrdem {
  evento: EventoOrdemTipo
  etapaDe: Etapa | null
  etapaPara: Etapa | null
  dados: Record<string, unknown>
  usuarioNome: string
  em: string
}

export interface OrdemDetalhe extends OrdemResumo {
  entradaId: string | null
  garantia: string
  cnpj: string
  laudo: string
  nf: { numero: string; situacao: 'aprovada' | 'reprovada' } | null
  defeitos: DefeitoDaOrdem[]
  pecas: PecaDaOrdem[]
  trocasNs: TrocaNs[]
  historico: EventoOrdem[]
}

export interface DefeitoSat {
  id: string
  descricao: string
  codigoCompels: string | null
}

const CAMPOS_RESUMO = 'id, numero, etapa, etapa_desde, tipo, cliente, ns_atual, produto, ticket_numero, tecnico_nome, criado_em'

export function ordemResumoDaLinha(l: Linha, agora: number): OrdemResumo {
  return {
    id: txt(l.id), numero: txt(l.numero), etapa: ehEtapa(l.etapa) ? l.etapa : 'recebido',
    etapaDesde: txt(l.etapa_desde), tempoNaEtapa: tempoDesde(txt(l.etapa_desde), agora),
    tipo: ehTipo(l.tipo) ? l.tipo : null, cliente: txt(l.cliente), nsAtual: txt(l.ns_atual), produto: txt(l.produto),
    ticketNumero: txt(l.ticket_numero), tecnicoNome: txt(l.tecnico_nome), criadoEm: txt(l.criado_em),
  }
}

export function eventoDaLinha(l: Linha): EventoOrdem {
  return {
    evento: txt(l.evento) as EventoOrdemTipo,
    etapaDe: ehEtapa(l.etapa_de) ? l.etapa_de : null,
    etapaPara: ehEtapa(l.etapa_para) ? l.etapa_para : null,
    dados: objeto(l.dados), usuarioNome: txt(l.usuario_nome), em: txt(l.em),
  }
}

// ---------- leitura ----------
export async function listarOrdens(f: FiltroOrdens, agora = Date.now()): Promise<OrdemResumo[]> {
  const sb = await createServerSupabase()
  let q = sb.from('sat_ordens').select(CAMPOS_RESUMO)
  if (f.tipo === 'a_definir') q = q.is('tipo', null)
  else if (ehTipo(f.tipo)) q = q.eq('tipo', f.tipo)
  if (f.cliente.trim() !== '') q = q.ilike('cliente', `%${literal(f.cliente.trim())}%`)
  if (f.ns.trim() !== '') {
    const ns = normalizarNs(f.ns)
    if (ns.sequencia) {
      const ids = await sb.rpc('sat_ordens_do_ns', { p_modelo: ns.modelo, p_sequencia: ns.sequencia })
      if (ids.error) throw new Error(`busca da OS pelo NS: ${ids.error.message}`)
      const lista = ((ids.data ?? []) as unknown[]).map((x) => String(x))
      if (lista.length === 0) return []
      q = q.in('id', lista)
    } else q = q.ilike('ns_atual', `%${literal(f.ns.trim())}%`)
  }
  if (DATA.test(f.de)) q = q.gte('criado_em', `${f.de}T00:00:00-03:00`)
  if (DATA.test(f.ate)) q = q.lte('criado_em', `${f.ate}T23:59:59.999-03:00`)
  const { data, error } = await q.order('etapa_desde', { ascending: true }).order('numero').limit(LIMITE_FILA)
  if (error) throw new Error(`ordens do SAT: ${error.message}`)
  return ((data ?? []) as Linha[]).map((l) => ordemResumoDaLinha(l, agora))
}

export async function lerOrdem(id: string, agora = Date.now()): Promise<OrdemDetalhe | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const sb = await createServerSupabase()
  const o = await sb.from('sat_ordens')
    .select(`${CAMPOS_RESUMO}, entrada_id, garantia, cnpj, laudo, entrada:sat_entradas(nf:sat_nfs(numero, situacao))`)
    .eq('id', id).maybeSingle()
  if (o.error) throw new Error(`OS do SAT: ${o.error.message}`)
  if (!o.data) return null
  const l = o.data as unknown as Linha

  const [d, p, n, h] = await Promise.all([
    sb.from('sat_ordem_defeitos').select('id, defeito_id, defeito_descricao, origem, solucao, usuario_nome, em').eq('ordem_id', id).order('em'),
    sb.from('sat_ordem_pecas').select('id, codigo, descricao, quantidade, situacao, usuario_nome, em').eq('ordem_id', id).order('em'),
    sb.from('sat_ordem_ns').select('id, ns_antigo, ns_novo, usuario_nome, em').eq('ordem_id', id).order('em'),
    sb.from('sat_ordem_historico').select('evento, etapa_de, etapa_para, dados, usuario_nome, em').eq('ordem_id', id).order('seq'),
  ])
  for (const r of [d, p, n, h]) if (r.error) throw new Error(`OS do SAT: ${r.error.message}`)

  const nf = embutido(embutido(l.entrada)?.nf)
  return {
    ...ordemResumoDaLinha(l, agora),
    entradaId: txtOuNull(l.entrada_id), garantia: txt(l.garantia), cnpj: txt(l.cnpj), laudo: txt(l.laudo),
    nf: nf ? { numero: txt(nf.numero), situacao: txt(nf.situacao) === 'aprovada' ? 'aprovada' : 'reprovada' } : null,
    defeitos: ((d.data ?? []) as Linha[]).map((x) => ({
      id: txt(x.id), defeitoId: txt(x.defeito_id), descricao: txt(x.defeito_descricao),
      origem: (txt(x.origem) === 'qualidade' ? 'qualidade' : 'manutencao') as DefeitoDaOrdem['origem'], solucao: txt(x.solucao),
      usuarioNome: txt(x.usuario_nome), em: txt(x.em),
    })),
    pecas: ((p.data ?? []) as Linha[]).map((x) => ({
      id: txt(x.id), codigo: txt(x.codigo), descricao: txt(x.descricao), quantidade: Number(x.quantidade),
      situacao: (txt(x.situacao) === 'devolvida' ? 'devolvida' : 'trocada') as PecaDaOrdem['situacao'],
      usuarioNome: txt(x.usuario_nome), em: txt(x.em),
    })),
    trocasNs: ((n.data ?? []) as Linha[]).map((x) => ({
      id: txt(x.id), nsAntigo: txt(x.ns_antigo), nsNovo: txt(x.ns_novo), usuarioNome: txt(x.usuario_nome), em: txt(x.em),
    })),
    historico: ((h.data ?? []) as Linha[]).map(eventoDaLinha),
  }
}

/** A OS de um relógio recebido (para o link na ficha do equipamento). */
export async function ordemDaEntrada(entradaId: string): Promise<{ id: string; numero: string; etapa: Etapa } | null> {
  if (!UUID.test(entradaId)) return null
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sat_ordens').select('id, numero, etapa').eq('entrada_id', entradaId).maybeSingle()
  if (error) throw new Error(`OS do relógio: ${error.message}`)
  if (!data) return null
  const l = data as Linha
  return { id: txt(l.id), numero: txt(l.numero), etapa: ehEtapa(l.etapa) ? l.etapa : 'recebido' }
}

export async function listarDefeitosAtivos(): Promise<DefeitoSat[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sat_defeitos').select('id, descricao, codigo_compels').eq('ativo', true).order('descricao')
  if (error) throw new Error(`defeitos do SAT: ${error.message}`)
  return ((data ?? []) as Linha[]).map((x) => ({ id: txt(x.id), descricao: txt(x.descricao), codigoCompels: txtOuNull(x.codigo_compels) }))
}

export async function produtoDaOrdem(id: string): Promise<string | null> {
  if (!UUID.test(id)) return null
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sat_ordens').select('produto').eq('id', id).maybeSingle()
  if (error) throw new Error(`produto da OS: ${error.message}`)
  return data ? txt((data as Linha).produto) : null
}

const pecas = (data: unknown) => ((data ?? []) as Linha[]).map((x) => ({ codigo: txt(x.codigo), descricao: txt(x.descricao) }))

/** Camada 1: as mais trocadas neste produto no histórico do ShopFloor. */
export async function pecasMaisUsadas(produto: string): Promise<PecaSugerida[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_pecas_mais_usadas', { p_produto: produto, p_limite: 15 })
  if (error) throw new Error(`peças mais usadas: ${error.message}`)
  return pecas(data)
}

/** Candidatos da camada 2: kits PMOE* já usados em alguma OS. */
export async function kitsConhecidos(): Promise<PecaSugerida[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_kits_conhecidos')
  if (error) throw new Error(`kits conhecidos: ${error.message}`)
  return pecas(data)
}

// ---------- gravação (funções da 0198) ----------
async function chamar(funcao: string, args: Record<string, unknown>): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.rpc(funcao, args)
  if (error) throw new ErroDoBanco(error.message)
}

export const iniciarManutencao = (ordemId: string) => chamar('sat_ordem_iniciar_manutencao', { p_ordem: ordemId })
export const adicionarDefeito = (ordemId: string, defeitoId: string, solucao: string) =>
  chamar('sat_ordem_defeito_adicionar', { p_ordem: ordemId, p_defeito: defeitoId, p_solucao: solucao })
export const removerDefeito = (itemId: string) => chamar('sat_ordem_defeito_remover', { p_item: itemId })
export const adicionarPeca = (ordemId: string, p: { codigo: string; descricao: string; quantidade: number }) =>
  chamar('sat_ordem_peca_adicionar', { p_ordem: ordemId, p_codigo: p.codigo, p_descricao: p.descricao, p_quantidade: p.quantidade })
export const removerPeca = (itemId: string) => chamar('sat_ordem_peca_remover', { p_item: itemId })
export const salvarLaudo = (ordemId: string, laudo: string) => chamar('sat_ordem_laudo_salvar', { p_ordem: ordemId, p_laudo: laudo })
export const trocarNs = (ordemId: string, ns: NsNormalizado) =>
  chamar('sat_ordem_trocar_ns', { p_ordem: ordemId, p: { ns: ns.escrito, modelo: ns.modelo, sequencia: ns.sequencia } })
export const enviarQualidade = (ordemId: string) => chamar('sat_ordem_enviar_qualidade', { p_ordem: ordemId })
export const corrigirEtapa = (ordemId: string, etapa: Etapa, motivo: string) =>
  chamar('sat_ordem_corrigir_etapa', { p_ordem: ordemId, p_etapa: etapa, p_motivo: motivo })
