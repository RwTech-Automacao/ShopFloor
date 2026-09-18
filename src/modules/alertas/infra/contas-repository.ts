import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { ehCanal, type Canal, type ContaVinculada } from '../domain/tipos'
import { mensagemErroAlerta } from '../domain/erros'

/** Código de vínculo do usuário logado (a função invalida os anteriores não usados). */
export async function gerarCodigoVinculo(): Promise<
  { ok: true; codigo: string; expiraEm: string } | { ok: false; erro: string }
> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_gerar_codigo')
  if (error) return { ok: false, erro: mensagemErroAlerta(error.message) }
  const r = (data ?? {}) as { codigo?: string; expira_em?: string }
  if (!r.codigo || !r.expira_em) return { ok: false, erro: mensagemErroAlerta(null) }
  return { ok: true, codigo: r.codigo, expiraEm: r.expira_em }
}

/** A RLS já limita às linhas do próprio usuário. */
export async function listarMinhasContas(): Promise<ContaVinculada[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('alerta_contas').select('canal, vinculado_em').order('canal')
  if (error) throw error
  const saida: ContaVinculada[] = []
  for (const l of (data ?? []) as { canal: string; vinculado_em: string }[]) {
    if (!ehCanal(l.canal)) continue
    saida.push({ canal: l.canal, vinculadoEm: l.vinculado_em })
  }
  return saida
}

export async function desvincularConta(canal: Canal): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.from('alerta_contas').delete().eq('canal', canal)
  if (error) throw error
}
