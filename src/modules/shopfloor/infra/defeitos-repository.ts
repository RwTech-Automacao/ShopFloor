import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { Defeito, TipoDefeito } from '../domain/defeito'

export async function listarDefeitos(): Promise<Defeito[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_defeitos').select('codigo,tipo').order('codigo')
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as { codigo: string; tipo: number }
    return { codigo: row.codigo, tipo: (row.tipo === 2 ? 2 : 1) as TipoDefeito }
  })
}

export async function inserirDefeito(
  d: Defeito,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_defeitos').insert({ codigo: d.codigo, tipo: d.tipo })
  if (error) {
    // 23505 = unique_violation (a PK codigo já existe).
    if (error.code === '23505') return { ok: false, erro: 'Esse defeito já existe.' }
    throw error
  }
  return { ok: true }
}

export async function excluirDefeito(codigo: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_defeitos').delete().eq('codigo', codigo)
  if (error) throw error
}
