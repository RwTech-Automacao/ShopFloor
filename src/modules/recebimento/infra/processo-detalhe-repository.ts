import { createServerSupabase } from '@/shared/lib/supabase/server'
import { sanitizarTermoBusca } from '../domain/busca-processo'
import type { StatusProcesso } from '../domain/ciclo-vida'

/**
 * Linha completa de `processos_recebimento` (todas as colunas, em
 * snake_case — espelha o schema do banco, como em `ProcessoResumoRow`).
 */
export interface ProcessoRow {
  id: string
  numero: number
  importacao_id: string | null
  status: StatusProcesso
  // comercial
  numero_nf: string | null
  numero_emb: string | null
  di_inpi: string | null
  acp_cliente: string | null
  numero_pedido: string | null
  data_chegada: string | null
  data_compra: string | null
  data_prevista: string | null
  atraso: string | null
  tipo: string | null
  comprador: string | null
  fornecedor: string | null
  critico: string | null
  // material
  codigo_material: string | null
  descricao_material: string | null
  quantidade_pedido: number | null
  // recebimento
  quantidade_recebida: number | null
  volumes: number | null
  divergencia: string | null
  responsavel_recebimento: string | null
  tipo_entrega: string | null
  amostral: string | null
  part_number_recebido: string | null
  // qualidade
  inscricoes: string | null
  fabricante: string | null
  medida_eletrica: string | null
  coloracao: string | null
  dimensional: string | null
  impressoes: string | null
  data_validade: string | null
  revisao: string | null
  material: string | null
  resultado: string | null
  quantidade_reprovada: number | null
  motivo_reprovacao: string | null
  rnc: string | null
  rac: string | null
  observacao: string | null
  responsavel_qualidade: string | null
  // auditoria
  criado_por: string | null
  atualizado_por: string | null
  finalizado_por: string | null
  finalizado_em: string | null
  cancelado_por: string | null
  motivo_cancelamento: string | null
  created_at: string
  updated_at: string
}

export interface CampoFormulario {
  campo: string
  rotulo: string
  grupo: 'comercial' | 'material' | 'recebimento' | 'qualidade'
  tipo: 'texto' | 'lista' | 'numero' | 'data'
  listaChave: string | null
  origem: 'comercial' | 'recebimento'
  obrigatorioFinalizacao: boolean
  obrigatorioImportacao: boolean
  ordem: number
  calculado: boolean
  formula: string | null
  formulaConfig: Record<string, string>
}

interface ConfiguracaoCampoFormularioRow {
  campo: string
  rotulo: string
  grupo: 'comercial' | 'material' | 'recebimento' | 'qualidade'
  tipo: 'texto' | 'lista' | 'numero' | 'data'
  lista_chave: string | null
  origem: 'comercial' | 'recebimento'
  obrigatorio_finalizacao: boolean
  obrigatorio_importacao: boolean
  ordem: number
  calculado: boolean
  formula: string | null
  formula_config: Record<string, string>
}

// Colunas de `processos_recebimento` que podem ser gravadas por
// `atualizarProcesso`: os campos de negócio configuráveis (mesmos nomes de
// `configuracao_campos.campo`) + os campos de auditoria/status controlados
// pelas Server Actions de salvar/transicionar. Fora dessa lista (id, numero,
// importacao_id, criado_por, created_at, updated_at) nunca é gravável por
// aqui — é o repositório, e não só o tipo, que garante isso em runtime.
type ColunaGravavel =
  | 'numero_nf'
  | 'numero_emb'
  | 'di_inpi'
  | 'acp_cliente'
  | 'numero_pedido'
  | 'data_chegada'
  | 'data_compra'
  | 'data_prevista'
  | 'atraso'
  | 'tipo'
  | 'comprador'
  | 'fornecedor'
  | 'critico'
  | 'codigo_material'
  | 'descricao_material'
  | 'quantidade_pedido'
  | 'quantidade_recebida'
  | 'volumes'
  | 'divergencia'
  | 'responsavel_recebimento'
  | 'tipo_entrega'
  | 'amostral'
  | 'part_number_recebido'
  | 'inscricoes'
  | 'fabricante'
  | 'medida_eletrica'
  | 'coloracao'
  | 'dimensional'
  | 'impressoes'
  | 'data_validade'
  | 'revisao'
  | 'material'
  | 'resultado'
  | 'quantidade_reprovada'
  | 'motivo_reprovacao'
  | 'rnc'
  | 'rac'
  | 'observacao'
  | 'responsavel_qualidade'
  | 'status'
  | 'atualizado_por'
  | 'finalizado_por'
  | 'finalizado_em'
  | 'cancelado_por'
  | 'motivo_cancelamento'

const COLUNAS_GRAVAVEIS = new Set<ColunaGravavel>([
  'numero_nf',
  'numero_emb',
  'di_inpi',
  'acp_cliente',
  'numero_pedido',
  'data_chegada',
  'data_compra',
  'data_prevista',
  'atraso',
  'tipo',
  'comprador',
  'fornecedor',
  'critico',
  'codigo_material',
  'descricao_material',
  'quantidade_pedido',
  'quantidade_recebida',
  'volumes',
  'divergencia',
  'responsavel_recebimento',
  'tipo_entrega',
  'amostral',
  'part_number_recebido',
  'inscricoes',
  'fabricante',
  'medida_eletrica',
  'coloracao',
  'dimensional',
  'impressoes',
  'data_validade',
  'revisao',
  'material',
  'resultado',
  'quantidade_reprovada',
  'motivo_reprovacao',
  'rnc',
  'rac',
  'observacao',
  'responsavel_qualidade',
  'status',
  'atualizado_por',
  'finalizado_por',
  'finalizado_em',
  'cancelado_por',
  'motivo_cancelamento',
])

export type PatchProcesso = Partial<Pick<ProcessoRow, ColunaGravavel>>

interface ListaItemResultadoRow {
  valor: string
  listas: { chave: string } | null
}

/**
 * Retorna os valores possíveis de `status` para o filtro da lista de
 * Processos: os dois estados fixos do ciclo de vida (`aberto`,
 * `em_conferencia`) seguidos dos terminais dinâmicos ativos cadastrados na
 * lista "Resultado" (ex.: Aprovado, Reprovado, e o que o Admin adicionar).
 */
export async function listarValoresStatus(): Promise<{ valor: string; rotulo: string }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('lista_itens')
    .select('valor, listas!inner(chave)')
    .eq('listas.chave', 'resultado')
    .eq('ativo', true)
    .order('ordem', { ascending: true })
  if (error) throw error

  const terminais = ((data ?? []) as unknown as ListaItemResultadoRow[]).map((row) => ({
    valor: row.valor,
    rotulo: row.valor,
  }))

  return [
    { valor: 'aberto', rotulo: 'Aberto' },
    { valor: 'em_conferencia', rotulo: 'Em conferência' },
    ...terminais,
  ]
}

/**
 * Busca um processo de recebimento pelo id (todas as colunas). `null` se não
 * existir ou se a RLS (`processos_select`, exige `visualizar`) não permitir.
 */
export async function buscarProcesso(id: string): Promise<ProcessoRow | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('processos_recebimento')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as ProcessoRow | null) ?? null
}

/**
 * Carrega todos os campos ativos de `configuracao_campos` (comercial +
 * material + recebimento + qualidade) para montar o formulário de detalhe do
 * processo. Ordenados por `ordem`: os valores cadastrados já seguem a
 * sequência de grupos comercial → material → recebimento → qualidade, então
 * ordenar só por `ordem` mantém os grupos contíguos sem depender da ordem
 * alfabética do texto do grupo (que colocaria "qualidade" antes de
 * "recebimento").
 */
export async function carregarCamposFormulario(): Promise<CampoFormulario[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('configuracao_campos')
    .select(
      'campo, rotulo, grupo, tipo, lista_chave, origem, obrigatorio_finalizacao, obrigatorio_importacao, ordem, calculado, formula, formula_config',
    )
    .eq('ativo', true)
    .order('ordem', { ascending: true })

  if (error) throw error

  return ((data ?? []) as ConfiguracaoCampoFormularioRow[]).map((row) => ({
    campo: row.campo,
    rotulo: row.rotulo,
    grupo: row.grupo,
    tipo: row.tipo,
    listaChave: row.lista_chave,
    origem: row.origem,
    obrigatorioFinalizacao: row.obrigatorio_finalizacao,
    obrigatorioImportacao: row.obrigatorio_importacao,
    ordem: row.ordem,
    calculado: row.calculado,
    formula: row.formula,
    formulaConfig: row.formula_config ?? {},
  }))
}

/**
 * Atualiza um processo de recebimento. Só grava as chaves de `patch` que
 * estão em `COLUNAS_GRAVAVEIS` — qualquer outra chave é ignorada (defesa em
 * profundidade: a validação de quais campos podem ser editados já acontece
 * na Server Action, isto aqui é a segunda barreira antes do RLS).
 *
 * Verifica que a atualização de fato afetou uma linha: se o RLS
 * (`processos_update`, exige `editar`) filtrar a linha por permissão, ou se
 * o `id` não existir, o Postgrest retorna sucesso com zero linhas — sem essa
 * checagem o chamador reportaria sucesso e gravaria um log de auditoria
 * (imutável) para uma alteração que nunca aconteceu.
 */
export async function atualizarProcesso(id: string, patch: PatchProcesso): Promise<void> {
  const supabase = await createServerSupabase()

  const patchFiltrado: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(patch)) {
    if (COLUNAS_GRAVAVEIS.has(chave as ColunaGravavel)) {
      patchFiltrado[chave] = valor
    }
  }
  if (Object.keys(patchFiltrado).length === 0) return

  const { data, error } = await supabase
    .from('processos_recebimento')
    .update(patchFiltrado)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Não foi possível salvar (registro não encontrado ou sem permissão).')
  }
}

/**
 * Insere um novo processo de recebimento. Espelha a whitelist de
 * `atualizarProcesso` (`COLUNAS_GRAVAVEIS`) e adiciona `criado_por`. NÃO
 * envia `numero` (sequência `processos_numero_seq`, default) nem `status`
 * (default 'aberto') — o banco atribui ambos. O RLS `processos_insert`
 * (0004/0007) já autoriza o INSERT para quem tem `editar`. Retorna o id e o
 * numero do processo recém-criado.
 */
export async function criarProcesso(
  patch: PatchProcesso & { criado_por: string },
): Promise<{ id: string; numero: number }> {
  const supabase = await createServerSupabase()

  const registro: Record<string, unknown> = { criado_por: patch.criado_por }
  for (const [chave, valor] of Object.entries(patch)) {
    if (chave === 'criado_por') continue
    // `status` está em COLUNAS_GRAVAVEIS (usado por atualizarProcesso), mas o
    // INSERT nunca deve enviá-lo: o banco aplica o default 'aberto'. Excluímos
    // explicitamente para a regra não depender da disciplina do chamador.
    if (chave === 'status') continue
    if (COLUNAS_GRAVAVEIS.has(chave as ColunaGravavel)) {
      registro[chave] = valor
    }
  }

  const { data, error } = await supabase
    .from('processos_recebimento')
    .insert(registro)
    .select('id, numero')
    .single()
  if (error) throw error
  if (!data) throw new Error('Não foi possível criar o processo.')
  return { id: data.id as string, numero: data.numero as number }
}

/**
 * Anterior/próximo do processo na ordem da lista filtrada, via RPC
 * `processos_vizinhos`. Fail-safe: qualquer erro devolve ambos `null` (setas
 * desabilitadas), sem quebrar a página.
 */
export async function buscarVizinhos(
  id: string,
  filtros: { busca?: string; status?: string },
): Promise<{ anterior: string | null; proximo: string | null }> {
  try {
    const supabase = await createServerSupabase()
    const buscaSanitizada = filtros.busca ? sanitizarTermoBusca(filtros.busca) : ''
    const { data, error } = await supabase.rpc('processos_vizinhos', {
      p_id: id,
      p_busca: buscaSanitizada || null,
      p_status: filtros.status ?? null,
    })
    if (error) throw error
    const row = (data ?? [])[0] as { anterior: string | null; proximo: string | null } | undefined
    return { anterior: row?.anterior ?? null, proximo: row?.proximo ?? null }
  } catch {
    return { anterior: null, proximo: null }
  }
}
