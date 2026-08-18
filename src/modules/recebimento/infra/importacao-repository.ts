import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface ImportacaoRow {
  id: string
  arquivo_nome: string
  formato: 'xlsx' | 'csv'
  total_processos_criados: number
  created_at: string
  usuario_id: string | null
  usuario_nome: string
}

interface RpcImportarProcessosResultado {
  importacao_id: string
  total: number
}

/**
 * Chama a RPC `importar_processos` (SECURITY INVOKER) com a sessão do
 * usuário — a permissão `importar` é validada pela RLS/RPC no banco.
 * Retorna o id da importação criada e o total de processos gerados, ou
 * lança em caso de erro (nenhum dado é gravado).
 */
export async function chamarImportarProcessos(payload: {
  arquivoNome: string
  formato: 'xlsx' | 'csv'
  mapeamento: Record<string, string>
  linhas: Record<string, string | number | null>[]
}): Promise<{ importacaoId: string; total: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('importar_processos', {
    p_arquivo_nome: payload.arquivoNome,
    p_formato: payload.formato,
    p_mapeamento: payload.mapeamento,
    p_linhas: payload.linhas,
  })

  if (error) throw error

  const resultado = data as unknown as RpcImportarProcessosResultado
  return { importacaoId: resultado.importacao_id, total: resultado.total }
}

/**
 * Lista as importações já realizadas (mais recentes primeiro), com o nome
 * do usuário responsável.
 */
export async function listarImportacoes(): Promise<ImportacaoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('importacoes')
    .select('id, arquivo_nome, formato, total_processos_criados, created_at, usuario_id, usuario_nome')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []) as unknown as ImportacaoRow[]
}

/**
 * Para cada importação com pelo menos um processo FORA de 'aberto' (já em
 * conferência/finalizado/cancelado), retorna quantos. A tela de Importações usa
 * isso para desabilitar o botão "Corrigir" — correção só vale enquanto tudo
 * está 'aberto'. Importações totalmente 'aberto' não aparecem no mapa.
 */
export async function bloqueiosPorImportacao(): Promise<Record<string, number>> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('processos_recebimento')
    .select('importacao_id')
    .neq('status', 'aberto')

  if (error) throw error

  const contagem: Record<string, number> = {}
  for (const linha of (data ?? []) as { importacao_id: string | null }[]) {
    if (linha.importacao_id) contagem[linha.importacao_id] = (contagem[linha.importacao_id] ?? 0) + 1
  }
  return contagem
}

export interface ImportacaoCorrecao {
  arquivoNome: string
  numeroEmb: string | null
  totalProcessos: number
  totalNaoAbertos: number
}

/**
 * Carrega o resumo de uma importação para o modo correção: a EMB alvo, o total
 * de processos e quantos já saíram de 'aberto' (se >0, a correção é bloqueada).
 * Retorna null se a importação não existir.
 */
export async function carregarImportacaoCorrecao(id: string): Promise<ImportacaoCorrecao | null> {
  const supabase = await createServerSupabase()
  const { data: importacao, error: erroImp } = await supabase
    .from('importacoes')
    .select('arquivo_nome')
    .eq('id', id)
    .maybeSingle()
  if (erroImp) throw erroImp
  if (!importacao) return null

  const { data: processos, error: erroProc } = await supabase
    .from('processos_recebimento')
    .select('numero_emb, status')
    .eq('importacao_id', id)
  if (erroProc) throw erroProc

  const linhas = (processos ?? []) as { numero_emb: string | null; status: string }[]
  const numeroEmb = linhas.find((p) => p.numero_emb)?.numero_emb ?? null
  const totalNaoAbertos = linhas.filter((p) => p.status !== 'aberto').length

  return {
    arquivoNome: (importacao as { arquivo_nome: string }).arquivo_nome,
    numeroEmb,
    totalProcessos: linhas.length,
    totalNaoAbertos,
  }
}

interface RpcCorrigirImportacaoResultado {
  importacao_id: string
  antes: number
  total: number
}

/**
 * Chama a RPC `corrigir_importacao` (SECURITY DEFINER): apaga os processos da
 * importação e insere os novos, atomicamente. A RPC valida a permissão e o
 * bloqueio (nada fora de 'aberto') e lança em caso de erro (nada é gravado).
 */
export async function chamarCorrigirImportacao(payload: {
  importacaoId: string
  arquivoNome: string
  formato: 'xlsx' | 'csv'
  mapeamento: Record<string, string>
  linhas: Record<string, string | number | null>[]
}): Promise<{ antes: number; total: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('corrigir_importacao', {
    p_importacao_id: payload.importacaoId,
    p_arquivo_nome: payload.arquivoNome,
    p_formato: payload.formato,
    p_mapeamento: payload.mapeamento,
    p_linhas: payload.linhas,
  })

  if (error) throw error

  const resultado = data as unknown as RpcCorrigirImportacaoResultado
  return { antes: resultado.antes, total: resultado.total }
}
