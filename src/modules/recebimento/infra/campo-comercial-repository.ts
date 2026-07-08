import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { CampoImportavel } from '../domain/mapeamento'

interface ConfiguracaoCampoRow {
  campo: string
  rotulo: string
  tipo: 'texto' | 'lista' | 'numero' | 'data'
  lista_chave: string | null
  obrigatorio_importacao: boolean
}

interface ListaItemRow {
  valor: string
  listas: { chave: string } | null
}

/**
 * Carrega os campos importáveis de origem comercial (ativos), na ordem de
 * exibição configurada, já mapeados para o tipo de domínio `CampoImportavel`.
 */
export async function carregarCamposComerciais(): Promise<CampoImportavel[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('configuracao_campos')
    .select('campo, rotulo, tipo, lista_chave, obrigatorio_importacao')
    .eq('origem', 'comercial')
    .eq('ativo', true)
    .order('ordem', { ascending: true })

  if (error) throw error

  return ((data ?? []) as ConfiguracaoCampoRow[]).map((row) => ({
    campo: row.campo,
    rotulo: row.rotulo,
    tipo: row.tipo,
    listaChave: row.lista_chave,
    obrigatorioImportacao: row.obrigatorio_importacao,
  }))
}

/**
 * Carrega os itens ativos das listas indicadas (por `chave`), agrupados por
 * chave da lista. Usado para validar/traduzir valores de campos do tipo
 * `lista` durante a importação.
 */
export async function carregarItensPorLista(
  chaves: string[],
): Promise<Record<string, string[]>> {
  if (chaves.length === 0) return {}

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('lista_itens')
    .select('valor, listas!inner(chave)')
    .eq('ativo', true)
    .in('listas.chave', chaves)
    .order('ordem', { ascending: true })

  if (error) throw error

  const porLista: Record<string, string[]> = {}
  for (const row of (data ?? []) as unknown as ListaItemRow[]) {
    const chave = row.listas?.chave
    if (!chave) continue
    ;(porLista[chave] ??= []).push(row.valor)
  }
  return porLista
}
