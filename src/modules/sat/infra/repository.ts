import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarNs } from '../domain/numero-serie'
import { ordenarOs, type ItemJunto, type NotaValida, type SituacaoNf } from '../domain/entrada'
import type { DadosDoBanco, OsDoNs } from '../application/consultar-ns'

/**
 * Leituras e gravações do SAT com a sessão do usuário (migrações 0186 e 0187): leitura pelo RLS
 * (`sat.visualizar`); escrita SÓ pelas funções security definer, que conferem a permissão de novo no banco.
 */
export class ErroDoBanco extends Error {
  constructor(public readonly codigo: string) {
    super(codigo)
    this.name = 'ErroDoBanco'
  }
}

type Linha = Record<string, unknown>
const txt = (v: unknown) => (typeof v === 'string' ? v : '')
const txtOuNull = (v: unknown) => (typeof v === 'string' ? v : null)
const numOuNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const textos = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** O PostgREST devolve o recurso embutido (muitos-para-um) como objeto; por garantia aceita lista. */
const embutido = (v: unknown): Linha | null => ((Array.isArray(v) ? v[0] : v) as Linha | null | undefined) ?? null
/** Escapa os curingas do ILIKE (o texto do filtro é literal). */
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

// ---------- planilha ----------
const CAMPOS_OS = 'id, numero, data, tecnico, cliente, equipamento, garantia, primeiro_registro, defeito, ' +
  'observacao, solucao, vendedor'

/**
 * As OS da planilha que têm este NS (pelo par; sem modelo, só pela sequência), com as peças deste NS e se a OS já
 * está ligada a alguma entrada (`emUso`).
 */
export async function osPorNs(ns: { modelo: string | null; sequencia: string }): Promise<OsDoNs[]> {
  const sb = await createServerSupabase()
  let q = sb.from('sat_os_itens')
    .select(`ns_escrito, codigo_peca, peca, quantidade, os:sat_os(${CAMPOS_OS})`)
    .eq('sequencia', ns.sequencia)
  if (ns.modelo) q = q.eq('modelo', ns.modelo)
  const { data, error } = await q.limit(500)
  if (error) throw new Error(`OS do NS: ${error.message}`)
  const porId = new Map<string, OsDoNs>()
  for (const l of (data ?? []) as unknown as Linha[]) {
    const o = l.os as Linha | null
    if (!o) continue
    const id = txt(o.id)
    let os = porId.get(id)
    if (!os) {
      os = {
        id, numero: txt(o.numero), data: txtOuNull(o.data), tecnico: txt(o.tecnico), cliente: txt(o.cliente),
        equipamento: txt(o.equipamento), garantia: txt(o.garantia), primeiroRegistro: txt(o.primeiro_registro),
        defeito: txt(o.defeito), observacao: txt(o.observacao), solucao: txt(o.solucao), vendedor: txt(o.vendedor),
        pecas: [], emUso: false,
      }
      porId.set(id, os)
    }
    os.pecas.push({ nsEscrito: txt(l.ns_escrito), codigoPeca: txt(l.codigo_peca), peca: txt(l.peca), quantidade: numOuNull(l.quantidade) })
  }
  const ids = [...porId.keys()]
  if (ids.length > 0) {
    const usadas = await sb.from('sat_entradas').select('os_id').in('os_id', ids)
    if (usadas.error) throw new Error(`OS em uso: ${usadas.error.message}`)
    for (const u of (usadas.data ?? []) as Linha[]) {
      const os = porId.get(txt(u.os_id))
      if (os) os.emUso = true
    }
  }
  return [...porId.values()]
}

/** Repinmetro e ShopFloor pela função `sat_consultar_ns` (o perfil do SAT não lê essas tabelas). */
export async function consultarNoBanco(modelo: string | null, sequencia: string | null, snsNorm: string[]): Promise<DadosDoBanco> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_consultar_ns', { p_modelo: modelo, p_sequencia: sequencia, p_sns_norm: snsNorm })
  if (error) throw new ErroDoBanco(error.message)
  const d = (data ?? {}) as { revendas?: Linha[]; producao?: Linha[]; shopfloor?: Linha[] }
  return {
    revendas: (d.revendas ?? []).map((r) => ({
      numeroSerieCompleto: txt(r.numero_serie_completo), revenda: txtOuNull(r.revenda),
      gravadaEm: txtOuNull(r.gravada_em), saidaEm: txtOuNull(r.saida_em),
    })),
    producao: (d.producao ?? []).map((p) => ({
      numeroSerie: txt(p.numero_serie), modelo: txtOuNull(p.modelo), dataInicio: txtOuNull(p.data_inicio),
      dataFim: txtOuNull(p.data_fim), status: txtOuNull(p.status),
      seriais: Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('serial_')).map(([k, v]) => [k, txtOuNull(v)])),
    })),
    shopfloor: (d.shopfloor ?? []).map((s) => ({
      pmo: txt(s.pmo), op: txt(s.op), cliente: txt(s.cliente), descricao: txt(s.descricao),
      ultimoPosto: txt(s.ultimo_posto), ultimoEm: txt(s.ultimo_em),
    })),
  }
}

// ---------- motivos ----------
export interface MotivoNf {
  id: string
  texto: string
  ativo: boolean
}

export async function listarMotivos(): Promise<MotivoNf[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sat_motivos_nf').select('id, texto, ativo').order('texto')
  if (error) throw new Error(`motivos: ${error.message}`)
  return ((data ?? []) as Linha[]).map((m) => ({ id: txt(m.id), texto: txt(m.texto), ativo: m.ativo === true }))
}

// ---------- a nota e os relógios ----------
/** `valor` vai como texto numérico com ponto (ou null), como `sat_registrar_nf`/`sat_trocar_nf` esperam. */
const valorParaBanco = (v: number | null) => (v === null ? null : String(v))

export async function registrarNf(n: NotaValida): Promise<{
  nfId: string; motivos: string[]; relogios: { id: string; ns: string; osNumero: string }[]
}> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_registrar_nf', {
    p: {
      numero: n.numero, cnpj: n.cnpj, empresa: n.empresa, negociante_codigo: n.negocianteCodigo,
      valor: valorParaBanco(n.valor), situacao: n.situacao, motivos: n.motivos,
      relogios: n.relogios.map((r) => ({
        ns: r.ns, modelo: r.modelo, sequencia: r.sequencia, produto: r.produto, itens_junto: r.itensJunto,
        itens_junto_outros: r.itensJuntoOutros, locacao: r.locacao,
      })),
    },
  })
  if (error) throw new ErroDoBanco(error.message)
  const d = (data ?? {}) as Linha
  return {
    nfId: txt(d.nf_id),
    motivos: textos(d.motivos),
    relogios: ((d.relogios as Linha[] | null) ?? []).map((r) => ({ id: txt(r.id), ns: txt(r.ns), osNumero: txt(r.os_numero) })),
  }
}

export interface MudancaGravada {
  nfId: string
  numeroDe: string
  numeroPara: string
  empresa: string
  cnpj: string
  situacaoDe: SituacaoNf
  situacaoPara: SituacaoNf
  motivos: string[]
  /** Os NS de todos os relógios da nota. */
  ns: string[]
}

function lerMudanca(d: Linha): MudancaGravada {
  return {
    nfId: txt(d.nf_id), numeroDe: txt(d.numero_de), numeroPara: txt(d.numero_para), empresa: txt(d.empresa),
    cnpj: txt(d.cnpj), situacaoDe: txt(d.situacao_de) as SituacaoNf, situacaoPara: txt(d.situacao_para) as SituacaoNf,
    motivos: textos(d.motivos), ns: textos(d.ns),
  }
}

export async function corrigirNf(nfId: string, situacao: SituacaoNf, motivos: string[]): Promise<MudancaGravada> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_corrigir_nf', { p_nf: nfId, p_situacao: situacao, p_motivos: motivos })
  if (error) throw new ErroDoBanco(error.message)
  return lerMudanca((data ?? {}) as Linha)
}

export async function trocarNf(nfId: string, t: {
  numero: string; cnpj: string; empresa: string; negocianteCodigo: string | null; valor: number | null
  situacao: SituacaoNf; motivos: string[]
}): Promise<MudancaGravada> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_trocar_nf', {
    p_nf: nfId,
    p: {
      numero: t.numero, cnpj: t.cnpj, empresa: t.empresa, negociante_codigo: t.negocianteCodigo,
      valor: valorParaBanco(t.valor), situacao: t.situacao, motivos: t.motivos,
    },
  })
  if (error) throw new ErroDoBanco(error.message)
  return lerMudanca((data ?? {}) as Linha)
}

/** O técnico liga o relógio a outra OS do mesmo NS, ou a nenhuma (`osId` null). */
export async function associarOs(entradaId: string, osId: string | null): Promise<{ ns: string; osDe: string; osPara: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_associar_os', { p_entrada: entradaId, p_os: osId })
  if (error) throw new ErroDoBanco(error.message)
  const d = (data ?? {}) as Linha
  return { ns: txt(d.ns), osDe: txt(d.os_de), osPara: txt(d.os_para) }
}

// ---------- lista e ficha ----------
export interface FiltroEntradas {
  situacao: '' | SituacaoNf
  /** Trecho do nome da empresa da nota. */
  cliente: string
  ns: string
  /** `aaaa-mm-dd` (inclusive). */
  de: string
  ate: string
}

/** Uma linha por relógio, com a nota dele. */
export interface EntradaResumo {
  id: string
  nfId: string
  nsEscrito: string
  empresa: string
  cnpj: string
  produto: string
  osNumero: string
  /** Número da NF. */
  nf: string
  situacao: SituacaoNf
  locacao: string
  data: string
  responsavelNome: string
}

const LIMITE_LISTA = 300
const DATA = /^\d{4}-\d{2}-\d{2}$/

export async function listarEntradas(f: FiltroEntradas): Promise<EntradaResumo[]> {
  const sb = await createServerSupabase()
  // `!inner`: os filtros na nota (situação, empresa) cortam as linhas do relógio.
  let q = sb.from('sat_entradas')
    .select('id, nf_id, ns_escrito, produto, os_numero, locacao, data, responsavel_nome, ' +
      'nf:sat_nfs!inner(numero, cnpj, empresa, situacao)')
  if (f.situacao === 'aprovada' || f.situacao === 'reprovada') q = q.eq('nf.situacao', f.situacao)
  if (f.cliente.trim() !== '') q = q.ilike('nf.empresa', `%${literal(f.cliente.trim())}%`)
  if (f.ns.trim() !== '') {
    const ns = normalizarNs(f.ns)
    if (ns.sequencia) {
      q = q.eq('sequencia', ns.sequencia)
      if (ns.modelo) q = q.eq('modelo', ns.modelo)
    } else q = q.ilike('ns_escrito', `%${literal(f.ns.trim())}%`)
  }
  if (DATA.test(f.de)) q = q.gte('data', f.de)
  if (DATA.test(f.ate)) q = q.lte('data', f.ate)
  const { data, error } = await q.order('criado_em', { ascending: false }).limit(LIMITE_LISTA)
  if (error) throw new Error(`entradas do SAT: ${error.message}`)
  return ((data ?? []) as unknown as Linha[]).map((e) => {
    const n = embutido(e.nf) ?? {}
    return {
      id: txt(e.id), nfId: txt(e.nf_id), nsEscrito: txt(e.ns_escrito), empresa: txt(n.empresa), cnpj: txt(n.cnpj),
      produto: txt(e.produto), osNumero: txt(e.os_numero), nf: txt(n.numero), situacao: txt(n.situacao) as SituacaoNf,
      locacao: txt(e.locacao), data: txt(e.data), responsavelNome: txt(e.responsavel_nome),
    }
  })
}

export interface NotaDetalhe {
  id: string
  numero: string
  cnpj: string
  empresa: string
  valor: number | null
  situacao: SituacaoNf
  /** Textos dos motivos (a nota guarda o texto, não o id). */
  motivos: string[]
  data: string
  responsavelNome: string
}

export interface HistoricoSat {
  tipo: 'entrada' | 'correcao' | 'troca' | 'os'
  de: Record<string, unknown> | null
  para: Record<string, unknown>
  motivos: string[]
  usuarioNome: string
  em: string
  /** Só no tipo `os` (a troca de OS é de um relógio; o resto é da nota inteira). */
  entradaId: string | null
}

export interface EntradaDetalhe {
  id: string
  nsEscrito: string
  modelo: string | null
  sequencia: string | null
  produto: string
  itensJunto: ItemJunto[]
  itensJuntoOutros: string
  locacao: string
  data: string
  responsavelNome: string
  criadoEm: string
  /** Garantia e defeito vêm da OS (não são guardados na entrada). */
  os: { id: string; numero: string; garantia: string; defeito: string; solucao: string; data: string | null } | null
  nota: NotaDetalhe
  /** Os outros relógios da mesma nota (sem este). */
  outrosRelogios: { id: string; nsEscrito: string }[]
  /** As OS deste NS, mais recente primeiro, para o "Trocar OS" (com `emUso`). */
  osDoNs: OsDoNs[]
  /** Da nota inteira + as trocas de OS DESTE relógio, por `em`. */
  historico: HistoricoSat[]
}

const objetoOuNull = (v: unknown) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

export async function lerEntrada(id: string): Promise<EntradaDetalhe | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const sb = await createServerSupabase()
  const e = await sb.from('sat_entradas')
    .select('id, nf_id, ns_escrito, modelo, sequencia, produto, itens_junto, itens_junto_outros, locacao, data, ' +
      'responsavel_nome, criado_em, os:sat_os(id, numero, garantia, defeito, solucao, data), ' +
      'nf:sat_nfs(id, numero, cnpj, empresa, valor, situacao, motivos, data, responsavel_nome)')
    .eq('id', id).maybeSingle()
  if (e.error) throw new Error(`entrada do SAT: ${e.error.message}`)
  if (!e.data) return null
  const d = e.data as unknown as Linha
  const nfId = txt(d.nf_id)
  const modelo = txtOuNull(d.modelo)
  const sequencia = txtOuNull(d.sequencia)

  const [outros, h, osDoNs] = await Promise.all([
    sb.from('sat_entradas').select('id, ns_escrito').eq('nf_id', nfId).neq('id', id).order('criado_em').order('id'),
    sb.from('sat_historico').select('tipo, de, para, motivos, usuario_nome, em, entrada_id').eq('nf_id', nfId)
      .or(`entrada_id.is.null,entrada_id.eq.${id}`).order('em'),
    sequencia ? osPorNs({ modelo, sequencia }) : Promise.resolve([] as OsDoNs[]),
  ])
  if (outros.error) throw new Error(`relógios da nota: ${outros.error.message}`)
  if (h.error) throw new Error(`histórico da nota: ${h.error.message}`)

  const o = embutido(d.os)
  const n = embutido(d.nf) ?? {}
  return {
    id: txt(d.id), nsEscrito: txt(d.ns_escrito), modelo, sequencia, produto: txt(d.produto),
    itensJunto: textos(d.itens_junto) as ItemJunto[], itensJuntoOutros: txt(d.itens_junto_outros),
    locacao: txt(d.locacao), data: txt(d.data), responsavelNome: txt(d.responsavel_nome), criadoEm: txt(d.criado_em),
    os: o
      ? { id: txt(o.id), numero: txt(o.numero), garantia: txt(o.garantia), defeito: txt(o.defeito), solucao: txt(o.solucao), data: txtOuNull(o.data) }
      : null,
    nota: {
      id: txt(n.id), numero: txt(n.numero), cnpj: txt(n.cnpj), empresa: txt(n.empresa), valor: numOuNull(n.valor),
      situacao: txt(n.situacao) as SituacaoNf, motivos: textos(n.motivos), data: txt(n.data),
      responsavelNome: txt(n.responsavel_nome),
    },
    outrosRelogios: ((outros.data ?? []) as Linha[]).map((r) => ({ id: txt(r.id), nsEscrito: txt(r.ns_escrito) })),
    osDoNs: ordenarOs(osDoNs),
    historico: ((h.data ?? []) as Linha[]).map((x) => ({
      tipo: txt(x.tipo) as HistoricoSat['tipo'], de: objetoOuNull(x.de), para: objetoOuNull(x.para) ?? {},
      motivos: textos(x.motivos), usuarioNome: txt(x.usuario_nome), em: txt(x.em), entradaId: txtOuNull(x.entrada_id),
    })),
  }
}
