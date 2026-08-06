import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { Conserto } from '../domain/conserto'

export async function listarConsertos(): Promise<Conserto[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_consertos').select('codigo').order('codigo')
  if (error) throw error
  return (data ?? []).map((r) => ({ codigo: (r as { codigo: string }).codigo }))
}

export async function inserirConserto(
  c: Conserto,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_consertos').insert({ codigo: c.codigo })
  if (error) {
    // 23505 = unique_violation (a PK codigo já existe).
    if (error.code === '23505') return { ok: false, erro: 'Esse conserto já existe.' }
    throw error
  }
  return { ok: true }
}

export async function excluirConserto(codigo: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_consertos').delete().eq('codigo', codigo)
  if (error) throw error
}
