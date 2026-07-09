import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { ProcessoEtiqueta } from '../domain/partnumber'

export type FiltroTipoEtiqueta = 'nf' | 'emb' | 'fornecedor'

/**
 * Mapeia o tipo de filtro escolhido na UI para a coluna correspondente em
 * `processos_recebimento` pesquisada via `ilike`.
 */
const COLUNA_POR_TIPO: Record<FiltroTipoEtiqueta, string> = {
  nf: 'numero_nf',
  emb: 'numero_emb',
  fornecedor: 'fornecedor',
}

/** Teto de linhas retornadas pela busca, para evitar varreduras enormes. */
const LIMITE_BUSCA = 500

const SELECT_CAMPOS = 'id, codigo_material, numero_pedido, di_inpi, numero_nf, volumes'

interface ProcessoEtiquetaRow {
  id: string
  codigo_material: string | null
  numero_pedido: string | null
  di_inpi: string | null
  numero_nf: string | null
  volumes: number | null
}

/**
 * Remove do termo de busca os caracteres com significado especial na
 * sintaxe do filtro `ilike`/`.or()` do PostgREST antes de interpolá-lo na
 * query (`,` `.` `(` `)` `*` `%`) — mesma abordagem de
 * `recebimento/domain/busca-processo.ts#sanitizarTermoBusca`, reimplementada
 * aqui para manter os módulos `etiquetas` e `recebimento` desacoplados.
 */
function sanitizarTermo(termo: string): string {
  return termo.replace(/[,.()*%]/g, '').trim()
}

function mapRow(row: ProcessoEtiquetaRow): ProcessoEtiqueta {
  return {
    id: row.id,
    codigoMaterial: row.codigo_material,
    numeroPedido: row.numero_pedido,
    diInpi: row.di_inpi,
    numeroNf: row.numero_nf,
    volumes: row.volumes,
  }
}

/**
 * Busca processos de recebimento por Nº NF, Nº embarque ou fornecedor
 * (`ilike`, case-insensitive) para a tela de geração de etiquetas. Termo
 * vazio (após sanitização) não filtra — devolve os processos mais recentes
 * até `LIMITE_BUSCA`, permitindo navegação sem digitar nada.
 */
export async function buscarProcessosParaEtiqueta({
  tipo,
  termo,
}: {
  tipo: FiltroTipoEtiqueta
  termo: string
}): Promise<ProcessoEtiqueta[]> {
  const supabase = await createServerSupabase()
  const coluna = COLUNA_POR_TIPO[tipo]
  const termoSanitizado = sanitizarTermo(termo)

  let query = supabase.from('processos_recebimento').select(SELECT_CAMPOS)
  if (termoSanitizado) {
    query = query.ilike(coluna, `%${termoSanitizado}%`)
  }

  const { data, error } = await query.order('numero', { ascending: false }).limit(LIMITE_BUSCA)
  if (error) throw error

  return ((data ?? []) as ProcessoEtiquetaRow[]).map(mapRow)
}

/**
 * Carrega os processos pelo `id`, na mesma forma de `ProcessoEtiqueta`, para
 * a geração efetiva das etiquetas (o servidor nunca confia nos dados de
 * processo eventualmente enviados pelo cliente — apenas nos ids).
 */
export async function carregarProcessosPorId(ids: string[]): Promise<ProcessoEtiqueta[]> {
  if (ids.length === 0) return []

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('processos_recebimento').select(SELECT_CAMPOS).in('id', ids)
  if (error) throw error

  return ((data ?? []) as ProcessoEtiquetaRow[]).map(mapRow)
}

export interface DadosGeracao {
  filtroTipo: FiltroTipoEtiqueta
  filtroValor: string
  totalProcessos: number
  totalEtiquetas: number
  processoIds: string[]
  usuarioId: string
  usuarioNome: string
}

/**
 * Registra uma geração de etiquetas em `geracoes_etiquetas` (histórico +
 * auditoria). A policy de insert exige `gerar_etiqueta` E
 * `usuario_id = auth.uid()` — o server action chamador já checou a
 * permissão antes, isto é o backstop de RLS. Devolve o id da linha criada,
 * usado como `entidadeId` no log da ação.
 */
export async function registrarGeracao(dados: DadosGeracao): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('geracoes_etiquetas')
    .insert({
      filtro_tipo: dados.filtroTipo,
      filtro_valor: dados.filtroValor,
      total_processos: dados.totalProcessos,
      total_etiquetas: dados.totalEtiquetas,
      processo_ids: dados.processoIds,
      usuario_id: dados.usuarioId,
      usuario_nome: dados.usuarioNome,
    })
    .select('id')
    .single()
  if (error) throw error

  return (data as { id: string }).id
}

export interface GeracaoRow {
  id: string
  filtro_tipo: FiltroTipoEtiqueta
  filtro_valor: string
  total_processos: number
  total_etiquetas: number
  usuario_nome: string
  created_at: string
}

/** Lista o histórico de gerações de etiquetas, mais recente primeiro. */
export async function listarGeracoes(): Promise<GeracaoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('geracoes_etiquetas')
    .select('id, filtro_tipo, filtro_valor, total_processos, total_etiquetas, usuario_nome, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data ?? []) as GeracaoRow[]
}
