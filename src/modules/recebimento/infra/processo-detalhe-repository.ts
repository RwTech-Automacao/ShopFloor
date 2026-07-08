import { createServerSupabase } from '@/shared/lib/supabase/server'
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
  responsavel_contagem: string | null
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
  | 'responsavel_contagem'
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
  'responsavel_contagem',
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
  'status',
  'atualizado_por',
  'finalizado_por',
  'finalizado_em',
  'cancelado_por',
  'motivo_cancelamento',
])

export type PatchProcesso = Partial<Pick<ProcessoRow, ColunaGravavel>>

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
      'campo, rotulo, grupo, tipo, lista_chave, origem, obrigatorio_finalizacao, ordem, calculado, formula, formula_config',
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
