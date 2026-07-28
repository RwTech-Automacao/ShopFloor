import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface PadraoFluxoRow {
  id: string
  pmo: string
  nome: string
  descricao: string
  postos: string[]
  componentes: string[]
}

export async function listarPadroes(): Promise<PadraoFluxoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_padroes_fluxo')
    .select('id,pmo,nome,descricao,postos,componentes')
    .order('pmo')
    .order('nome')
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as { id: string; pmo: string; nome: string; descricao: string; postos: unknown; componentes: unknown }
    return {
      id: row.id,
      pmo: row.pmo,
      nome: row.nome,
      descricao: row.descricao,
      postos: Array.isArray(row.postos) ? (row.postos as string[]) : [],
      componentes: Array.isArray(row.componentes) ? (row.componentes as string[]) : [],
    }
  })
}

export async function upsertPadrao(p: {
  pmo: string
  nome: string
  descricao: string
  postos: string[]
  componentes: string[]
}): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_padroes_fluxo')
    .upsert(
      { pmo: p.pmo, nome: p.nome, descricao: p.descricao, postos: p.postos, componentes: p.componentes, updated_at: new Date().toISOString() },
      { onConflict: 'pmo,nome' },
    )
  if (error) throw error
}

export async function excluirPadrao(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_padroes_fluxo').delete().eq('id', id)
  if (error) throw error
}
