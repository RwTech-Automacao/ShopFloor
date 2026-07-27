import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface BurninAberto {
  cliente: string
  pmo: string
  op: string
  numeroSerie: string
  entrada: string // ISO
}

/** Peças agora no Burn-in (entrada aberta), mais antigas primeiro. */
export async function listarBurninAberto(): Promise<BurninAberto[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_burnin_aberto')
    .select('cliente,pmo,op,numero_serie,entrada')
    .order('entrada', { ascending: true })
  if (error) throw error
  return (data as { cliente: string; pmo: string; op: string; numero_serie: string; entrada: string }[]).map((r) => ({
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    numeroSerie: r.numero_serie,
    entrada: r.entrada,
  }))
}
