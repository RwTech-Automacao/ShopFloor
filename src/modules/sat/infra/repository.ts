import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarNs } from '../domain/numero-serie'
import type { Frete, ItemJunto, SituacaoNf, EntradaValida } from '../domain/entrada'
import type { DadosDoBanco, OsDoNs } from '../application/consultar-ns'

/**
 * Leituras e gravações do SAT com a sessão do usuário (migração 0186): leitura pelo RLS (`sat.visualizar`);
 * escrita SÓ pelas funções security definer, que conferem a permissão de novo no banco.
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
/** Escapa os curingas do ILIKE (o texto do filtro é literal). */
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

// ---------- planilha ----------
const CAMPOS_OS = 'id, numero, data, tecnico, cliente, equipamento, garantia, primeiro_registro, defeito, ' +
  'observacao, solucao, vendedor'

/** As OS da planilha que têm este NS (pelo par; sem modelo, só pela sequência), com as peças deste NS. */
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
        pecas: [],
      }
      porId.set(id, os)
    }
    os.pecas.push({ nsEscrito: txt(l.ns_escrito), codigoPeca: txt(l.codigo_peca), peca: txt(l.peca), quantidade: numOuNull(l.quantidade) })
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

// ---------- entrada e NF ----------
export async function registrarEntrada(e: EntradaValida): Promise<{ id: string; osNumero: string; motivos: string[] }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_registrar_entrada', {
    p: {
      ns: e.ns, modelo: e.modelo, sequencia: e.sequencia, os_id: e.osId, empresa: e.empresa, cnpj: e.cnpj,
      produto: e.produto, nf: e.nf, valor: e.valor, frete: e.frete, itens_junto: e.itensJunto,
      itens_junto_outros: e.itensJuntoOutros, defeito: e.defeito, locacao: e.locacao, custo: e.custo,
      nf_situacao: e.situacao, motivos: e.motivos,
    },
  })
  if (error) throw new ErroDoBanco(error.message)
  const d = data as Linha
  return { id: txt(d.id), osNumero: txt(d.os_numero), motivos: (d.motivos as string[] | null) ?? [] }
}

export interface MudancaGravada {
  ns: string
  empresa: string
  osNumero: string
  nfDe: string
  nfPara: string
  situacaoDe: SituacaoNf
  situacaoPara: SituacaoNf
  motivos: string[]
}

function lerMudanca(d: Linha): MudancaGravada {
  return {
    ns: txt(d.ns), empresa: txt(d.empresa), osNumero: txt(d.os_numero), nfDe: txt(d.nf_de), nfPara: txt(d.nf_para),
    situacaoDe: txt(d.situacao_de) as SituacaoNf, situacaoPara: txt(d.situacao_para) as SituacaoNf,
    motivos: (d.motivos as string[] | null) ?? [],
  }
}

export async function corrigirNf(entradaId: string, situacao: SituacaoNf, motivos: string[]): Promise<MudancaGravada> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_corrigir_nf', { p_entrada: entradaId, p_situacao: situacao, p_motivos: motivos })
  if (error) throw new ErroDoBanco(error.message)
  return lerMudanca(data as Linha)
}

export async function trocarNf(entradaId: string, nf: string, situacao: SituacaoNf, motivos: string[]): Promise<MudancaGravada> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_trocar_nf', { p_entrada: entradaId, p_nf: nf, p_situacao: situacao, p_motivos: motivos })
  if (error) throw new ErroDoBanco(error.message)
  return lerMudanca(data as Linha)
}

// ---------- lista e ficha ----------
export interface FiltroEntradas {
  situacao: '' | SituacaoNf
  cliente: string
  ns: string
  /** `aaaa-mm-dd` (inclusive). */
  de: string
  ate: string
}

export interface EntradaResumo {
  id: string
  nsEscrito: string
  empresa: string
  produto: string
  osNumero: string
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
  let q = sb.from('sat_entradas')
    .select('id, ns_escrito, empresa, produto, os_numero, nf, nf_situacao, locacao, data, responsavel_nome')
  if (f.situacao === 'aprovada' || f.situacao === 'reprovada') q = q.eq('nf_situacao', f.situacao)
  if (f.cliente.trim() !== '') q = q.ilike('empresa', `%${literal(f.cliente.trim())}%`)
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
  return ((data ?? []) as Linha[]).map((e) => ({
    id: txt(e.id), nsEscrito: txt(e.ns_escrito), empresa: txt(e.empresa), produto: txt(e.produto),
    osNumero: txt(e.os_numero), nf: txt(e.nf), situacao: txt(e.nf_situacao) as SituacaoNf, locacao: txt(e.locacao),
    data: txt(e.data), responsavelNome: txt(e.responsavel_nome),
  }))
}

export interface HistoricoNf {
  tipo: 'entrada' | 'correcao' | 'troca'
  nfDe: string | null
  situacaoDe: SituacaoNf | null
  nfPara: string
  situacaoPara: SituacaoNf
  motivos: string[]
  usuarioNome: string
  em: string
}

export interface EntradaDetalhe extends EntradaResumo {
  modelo: string | null
  sequencia: string | null
  osId: string | null
  cnpj: string
  valor: number | null
  frete: Frete | null
  itensJunto: ItemJunto[]
  itensJuntoOutros: string
  defeito: string
  custo: number | null
  motivos: string[]
  criadoEm: string
  historico: HistoricoNf[]
}

export async function lerEntrada(id: string): Promise<EntradaDetalhe | null> {
  const sb = await createServerSupabase()
  const [e, h] = await Promise.all([
    sb.from('sat_entradas').select('*').eq('id', id).maybeSingle(),
    sb.from('sat_entradas_historico').select('*').eq('entrada_id', id).order('em'),
  ])
  if (e.error) throw new Error(`entrada do SAT: ${e.error.message}`)
  if (h.error) throw new Error(`histórico da entrada: ${h.error.message}`)
  if (!e.data) return null
  const d = e.data as Linha
  return {
    id: txt(d.id), nsEscrito: txt(d.ns_escrito), empresa: txt(d.empresa), produto: txt(d.produto),
    osNumero: txt(d.os_numero), nf: txt(d.nf), situacao: txt(d.nf_situacao) as SituacaoNf, locacao: txt(d.locacao),
    data: txt(d.data), responsavelNome: txt(d.responsavel_nome), modelo: txtOuNull(d.modelo),
    sequencia: txtOuNull(d.sequencia), osId: txtOuNull(d.os_id), cnpj: txt(d.cnpj), valor: numOuNull(d.valor),
    frete: txtOuNull(d.frete) as Frete | null, itensJunto: ((d.itens_junto as ItemJunto[] | null) ?? []),
    itensJuntoOutros: txt(d.itens_junto_outros), defeito: txt(d.defeito), custo: numOuNull(d.custo),
    motivos: (d.nf_motivos as string[] | null) ?? [], criadoEm: txt(d.criado_em),
    historico: ((h.data ?? []) as Linha[]).map((x) => ({
      tipo: txt(x.tipo) as HistoricoNf['tipo'], nfDe: txtOuNull(x.nf_de),
      situacaoDe: txtOuNull(x.situacao_de) as SituacaoNf | null, nfPara: txt(x.nf_para),
      situacaoPara: txt(x.situacao_para) as SituacaoNf, motivos: (x.motivos as string[] | null) ?? [],
      usuarioNome: txt(x.usuario_nome), em: txt(x.em),
    })),
  }
}
