import { createServerSupabase } from '@/shared/lib/supabase/server'
import { PERFIL_PADRAO, type PerfilPosto } from '../domain/perfil-posto'

interface PerfilRow {
  chave: string; nome: string; tem_status: boolean; reprova: string; gate: string; exige_manutencao: boolean; recurso: string
}
function paraPerfil(r: PerfilRow): PerfilPosto {
  return {
    chave: r.chave, nome: r.nome, temStatus: r.tem_status,
    reprova: r.reprova as PerfilPosto['reprova'], gate: r.gate as PerfilPosto['gate'],
    exigeManutencao: r.exige_manutencao, recurso: r.recurso as PerfilPosto['recurso'],
  }
}

export async function listarPerfis(): Promise<PerfilPosto[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_posto_perfis').select('chave,nome,tem_status,reprova,gate,exige_manutencao,recurso').order('nome')
  if (error) throw error
  return (data as PerfilRow[]).map(paraPerfil)
}

/** Mapa nome-do-posto → PerfilPosto (fallback passagem). */
export async function mapaPostoPerfil(): Promise<Record<string, PerfilPosto>> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_postos')
    .select('chave,perfil,sf_posto_perfis(chave,nome,tem_status,reprova,gate,exige_manutencao,recurso)')
  if (error) throw error
  const mapa: Record<string, PerfilPosto> = {}
  for (const row of (data as unknown as { chave: string; perfil: string | null; sf_posto_perfis: PerfilRow | null }[]) ?? []) {
    mapa[row.chave] = row.sf_posto_perfis ? paraPerfil(row.sf_posto_perfis) : PERFIL_PADRAO
  }
  return mapa
}

export async function postoEmUsoEmOrdem(chave: string): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { count, error } = await supabase.from('sf_ordem_postos').select('*', { count: 'exact', head: true }).eq('posto', chave)
  if (error) throw error
  return (count ?? 0) > 0
}

export async function criarPosto(p: { chave: string; ordem: number; perfil: string }): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_postos').insert({ chave: p.chave, ordem: p.ordem, perfil: p.perfil })
  if (error) throw error
}
export async function atualizarPosto(chave: string, p: { perfil: string }): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_postos').update({ perfil: p.perfil }).eq('chave', chave)
  if (error) throw error
}
export async function excluirPosto(chave: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_postos').delete().eq('chave', chave)
  if (error) throw error
}
